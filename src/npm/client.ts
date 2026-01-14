/**
 * Token Costs Client
 * Fetches and caches provider pricing data with daily refresh
 */

import type {
  Provider,
  BuiltInProvider,
  ProviderFile,
  ProviderData,
  ModelPricing,
  CostClientOptions,
  PriceLookupResult,
  CostResult,
  CustomProviderModels,
  DeprecationInfo,
} from './types.js';

// Default URL serves from GitHub Pages when configured, falls back to raw.githubusercontent.com
// Users can override with their own GitHub Pages URL via baseUrl option
const DEFAULT_BASE_URL =
  'https://raw.githubusercontent.com/mikkotikkanen/token-costs/main/docs/api/v1';

interface CacheEntry {
  data: ProviderFile;
  fetchedDate: string; // UTC date when we fetched (YYYY-MM-DD)
}

/**
 * Get UTC date as YYYY-MM-DD with optional offset
 */
function getUtcDate(offsetMs: number = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().split('T')[0];
}

/**
 * Calculate days difference between two YYYY-MM-DD dates
 */
function daysDifference(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T00:00:00Z').getTime();
  const b = new Date(dateB + 'T00:00:00Z').getTime();
  return Math.floor((a - b) / (24 * 60 * 60 * 1000));
}

/**
 * Error thrown when a clock mismatch is detected
 */
export class ClockMismatchError extends Error {
  constructor(
    public readonly clientDate: string,
    public readonly dataDate: string,
    public readonly daysDiff: number
  ) {
    super(
      `Clock mismatch detected: client thinks it's ${clientDate} but latest data is from ${dataDate} ` +
      `(${daysDiff} days difference). This may indicate your server clock is wrong. ` +
      `Use the timeOffsetMs option to adjust, or check your system clock.`
    );
    this.name = 'ClockMismatchError';
  }
}

/**
 * Token Costs Client
 *
 * Provides access to LLM pricing data with automatic caching and daily refresh.
 *
 * @example
 * ```ts
 * import { CostClient } from 'token-costs';
 *
 * const client = new CostClient();
 *
 * // Get pricing for a model
 * const pricing = await client.getModelPricing('openai', 'gpt-4o');
 * console.log(pricing.input, pricing.output);
 *
 * // Calculate cost
 * const cost = await client.calculateCost('anthropic', 'claude-sonnet-4', {
 *   inputTokens: 1000,
 *   outputTokens: 500,
 * });
 * console.log(cost.totalCost);
 * ```
 */
export class CostClient {
  private baseUrl: string;
  private fetchFn: typeof globalThis.fetch;
  private timeOffsetMs: number;
  private cache: Map<Provider, CacheEntry> = new Map();
  private externalCache?: CostClientOptions['externalCache'];
  private offline: boolean;
  private customProviders: Record<string, CustomProviderModels>;
  private suppressDeprecationWarnings: boolean;
  private onDeprecation?: (info: DeprecationInfo, provider: Provider) => void;
  private deprecationWarningsShown: Set<Provider> = new Set();

  constructor(options: CostClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeOffsetMs = options.timeOffsetMs ?? 0;
    this.externalCache = options.externalCache;
    this.offline = options.offline ?? false;
    this.customProviders = options.customProviders ?? {};
    this.suppressDeprecationWarnings = options.suppressDeprecationWarnings ?? false;
    this.onDeprecation = options.onDeprecation;
  }

  /**
   * Check if a provider is a built-in provider with remote data
   */
  private isBuiltInProvider(provider: Provider): provider is BuiltInProvider {
    return ['openai', 'anthropic', 'google', 'openrouter'].includes(provider)
      || provider.startsWith('openrouter/');
  }

  /**
   * Get today's date according to this client (with offset applied)
   */
  private getToday(): string {
    return getUtcDate(this.timeOffsetMs);
  }

  /**
   * Get cache key for external cache
   */
  private getCacheKey(provider: Provider): string {
    return `token-costs:${provider}`;
  }

  /**
   * Try to load from external cache
   */
  private async loadFromExternalCache(provider: Provider): Promise<CacheEntry | null> {
    if (!this.externalCache) return null;

    try {
      const raw = await this.externalCache.get(this.getCacheKey(provider));
      if (raw) {
        return JSON.parse(raw) as CacheEntry;
      }
    } catch {
      // External cache failed, continue without it
    }
    return null;
  }

  /**
   * Save to external cache
   */
  private async saveToExternalCache(provider: Provider, entry: CacheEntry): Promise<void> {
    if (!this.externalCache) return;

    try {
      await this.externalCache.set(this.getCacheKey(provider), JSON.stringify(entry));
    } catch {
      // External cache failed, continue without it
    }
  }

  /**
   * Handle deprecation warning for a provider
   * Only warns once per provider per client instance
   */
  private handleDeprecation(data: ProviderFile, provider: Provider): void {
    if (!data.deprecated) return;
    if (this.deprecationWarningsShown.has(provider)) return;

    this.deprecationWarningsShown.add(provider);

    if (this.onDeprecation) {
      // Custom handler provided
      this.onDeprecation(data.deprecated, provider);
    } else if (!this.suppressDeprecationWarnings) {
      // Default: console.warn
      const dep = data.deprecated;
      let warning = `[token-costs] DEPRECATION WARNING for '${provider}': ${dep.message}`;
      warning += `\n  Deprecated since: ${dep.since}`;
      warning += `\n  Data frozen after: ${dep.dataFrozenAt}`;
      if (dep.upgradeGuide) {
        warning += `\n  Upgrade guide: ${dep.upgradeGuide}`;
      }
      console.warn(warning);
    }
  }

  /**
   * Get custom provider data as a ProviderFile structure
   */
  private getCustomProviderFile(provider: Provider): ProviderFile | null {
    const customModels = this.customProviders[provider];
    if (!customModels) return null;

    return {
      current: {
        date: this.getToday(),
        models: customModels,
      },
    };
  }

  /**
   * Merge custom provider data into a ProviderFile
   */
  private mergeCustomData(file: ProviderFile, provider: Provider): ProviderFile {
    const customModels = this.customProviders[provider];
    if (!customModels) return file;

    return {
      ...file,
      current: {
        ...file.current,
        models: {
          ...file.current.models,
          ...customModels, // Custom takes precedence
        },
      },
    };
  }

  /**
   * Fetch provider data, using cache if available and fresh
   * @param provider - The provider to fetch
   * @param modelId - Optional model ID, used to extract sub-provider for OpenRouter
   */
  private async fetchProvider(provider: Provider, modelId?: string): Promise<ProviderFile> {
    // For openrouter, extract sub-provider from model ID (e.g., 'anthropic/claude-3.5-sonnet' -> 'openrouter/anthropic')
    let effectiveProvider = provider;
    if (provider === 'openrouter' && modelId && modelId.includes('/')) {
      const subProvider = modelId.split('/')[0];
      effectiveProvider = `openrouter/${subProvider}`;
    }

    const today = this.getToday();
    const isBuiltIn = this.isBuiltInProvider(effectiveProvider);
    const hasCustomData = effectiveProvider in this.customProviders;

    // Offline mode: only use custom data
    if (this.offline) {
      const customFile = this.getCustomProviderFile(provider);
      if (customFile) {
        return customFile;
      }
      throw new Error(
        `Provider '${provider}' not found. In offline mode, only customProviders data is available.`
      );
    }

    // Custom-only provider (not built-in): return custom data directly
    if (!isBuiltIn) {
      const customFile = this.getCustomProviderFile(provider);
      if (customFile) {
        return customFile;
      }
      throw new Error(
        `Provider '${provider}' not found. Use a built-in provider (openai, anthropic, google, openrouter) ` +
        `or add it to customProviders.`
      );
    }

    // Built-in provider: fetch from remote (with caching)
    // Check in-memory cache first
    let cached = this.cache.get(effectiveProvider);

    // If no in-memory cache, try external cache
    if (!cached && this.externalCache) {
      const external = await this.loadFromExternalCache(effectiveProvider);
      if (external) {
        cached = external;
        // Populate in-memory cache from external
        this.cache.set(effectiveProvider, external);
      }
    }

    // If we have cached data from today, use it (don't fetch again)
    if (cached && cached.fetchedDate === today) {
      this.handleDeprecation(cached.data, effectiveProvider);
      return this.mergeCustomData(cached.data, provider);
    }

    // Try to fetch fresh data
    const url = `${this.baseUrl}/${effectiveProvider}.json`;
    const response = await this.fetchFn(url);

    if (!response.ok) {
      // If fetch fails but we have cached data, use it
      if (cached) {
        this.handleDeprecation(cached.data, effectiveProvider);
        return this.mergeCustomData(cached.data, provider);
      }
      throw new Error(`Failed to fetch pricing data for ${effectiveProvider}: ${response.status}`);
    }

    const data = (await response.json()) as ProviderFile;
    const daysDiff = daysDifference(today, data.current.date);

    // Check for clock mismatch: data from future means our clock is behind
    if (daysDiff < 0) {
      throw new ClockMismatchError(today, data.current.date, daysDiff);
    }

    // Check for clock mismatch: data more than 1 day behind means our clock is ahead
    if (daysDiff > 1) {
      throw new ClockMismatchError(today, data.current.date, daysDiff);
    }

    // Cache the data with today's date so we don't fetch again today
    const entry: CacheEntry = { data, fetchedDate: today };
    this.cache.set(effectiveProvider, entry);
    await this.saveToExternalCache(effectiveProvider, entry);

    // Check for deprecation and warn user
    this.handleDeprecation(data, effectiveProvider);

    return this.mergeCustomData(data, provider);
  }

  /**
   * Get the effective pricing data, handling the dual-date fallback
   */
  private getEffectiveData(file: ProviderFile): ProviderData {
    // Always use current - the dual-date structure is for consumers
    // who want to detect if data is stale and handle it themselves
    return file.current;
  }

  /**
   * Get pricing for a specific model
   *
   * @param provider - The provider (openai, anthropic, google, openrouter)
   * @param modelId - The model identifier
   * @returns The pricing data for the model
   * @throws Error if model is not found
   */
  async getModelPricing(provider: Provider, modelId: string): Promise<PriceLookupResult> {
    const file = await this.fetchProvider(provider, modelId);
    const data = this.getEffectiveData(file);
    const pricing = data.models[modelId];

    if (!pricing) {
      const available = Object.keys(data.models).join(', ');
      throw new Error(
        `Model '${modelId}' not found for provider '${provider}'. Available: ${available}`
      );
    }

    // Data is stale if today's date (with offset) is newer than the data date
    const today = this.getToday();
    const stale = data.date < today;

    return {
      provider,
      modelId,
      pricing,
      date: data.date,
      stale,
    };
  }

  /**
   * Get pricing for a model, returning null if not found
   */
  async getModelPricingOrNull(
    provider: Provider,
    modelId: string
  ): Promise<PriceLookupResult | null> {
    try {
      return await this.getModelPricing(provider, modelId);
    } catch {
      return null;
    }
  }

  /**
   * Get all models for a provider
   */
  async getProviderModels(provider: Provider): Promise<Record<string, ModelPricing>> {
    const file = await this.fetchProvider(provider);
    return this.getEffectiveData(file).models;
  }

  /**
   * List all model IDs for a provider
   */
  async listModels(provider: Provider): Promise<string[]> {
    const models = await this.getProviderModels(provider);
    return Object.keys(models);
  }

  /**
   * Calculate cost for a given number of tokens
   *
   * @param provider - The provider
   * @param modelId - The model identifier
   * @param tokens - Token counts
   * @param tokens.inputTokens - Number of input tokens
   * @param tokens.outputTokens - Number of output tokens
   * @param tokens.cachedInputTokens - Number of cached input tokens (optional)
   */
  async calculateCost(
    provider: Provider,
    modelId: string,
    tokens: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
    }
  ): Promise<CostResult> {
    const { pricing, date, stale } = await this.getModelPricing(provider, modelId);

    // Validate this is a text model with token pricing
    if (pricing.input === undefined || pricing.output === undefined) {
      throw new Error(
        `Model '${modelId}' does not have token-based pricing. ` +
        `Use image/audio/video pricing fields instead.`
      );
    }

    const { inputTokens, outputTokens, cachedInputTokens = 0 } = tokens;

    // Calculate costs (prices are per million tokens)
    const regularInputTokens = inputTokens - cachedInputTokens;
    const usedCachedPricing = cachedInputTokens > 0 && pricing.cached !== undefined;

    let inputCost = (regularInputTokens / 1_000_000) * pricing.input;
    if (usedCachedPricing && pricing.cached !== undefined) {
      inputCost += (cachedInputTokens / 1_000_000) * pricing.cached;
    } else {
      // No cached pricing available, use regular input price
      inputCost += (cachedInputTokens / 1_000_000) * pricing.input;
    }

    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      usedCachedPricing,
      date,
      stale,
    };
  }

  /**
   * Get the raw provider file (includes both current and previous data)
   */
  async getRawProviderData(provider: Provider): Promise<ProviderFile> {
    return this.fetchProvider(provider);
  }

  /**
   * Get the date of the currently cached data for a provider
   * Returns null if no data is cached
   */
  getCachedDate(provider: Provider): string | null {
    const cached = this.cache.get(provider);
    return cached?.data.current.date ?? null;
  }

  /**
   * Clear the cache for a specific provider or all providers
   */
  clearCache(provider?: Provider): void {
    if (provider) {
      this.cache.delete(provider);
    } else {
      this.cache.clear();
    }
  }
}

