/**
 * Token Prices NPM Module Types
 */

/**
 * Variant pricing for resolution/quality dependent models
 */
export interface VariantPricing {
  /** Input cost for this variant */
  input?: number;
  /** Output cost for this variant */
  output?: number;
}

/**
 * Pricing data for a single model
 */
export interface ModelPricing {
  /** Price per 1M input tokens in USD */
  input?: number;
  /** Price per 1M output tokens in USD */
  output?: number;
  /** Price per 1M cached input tokens in USD (if supported) */
  cached?: number;
  /** Context window size in tokens */
  context?: number;
  /** Maximum output tokens */
  maxOutput?: number;

  /** Image pricing by resolution/quality (per image) */
  image?: Record<string, VariantPricing>;
  /** Audio pricing by quality (per minute) */
  audio?: Record<string, VariantPricing>;
  /** Video pricing by resolution (per second) */
  video?: Record<string, VariantPricing>;
}

/**
 * Provider pricing data for a single date
 */
export interface ProviderData {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Model pricing map: modelId -> pricing */
  models: Record<string, ModelPricing>;
}

/**
 * Dual-date structure for handling update timing
 * When fetching on a new day, if current.date hasn't updated yet,
 * the previous data is still valid to use
 */
export interface ProviderFile {
  /** Current/latest pricing data */
  current: ProviderData;
  /** Previous day's data (for fallback during updates) */
  previous?: ProviderData;
}

/**
 * Supported providers
 */
export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter';

/**
 * Options for the pricing client
 */
export interface PricingClientOptions {
  /**
   * Base URL for fetching pricing data
   * @default 'https://raw.githubusercontent.com/anthropics/token-prices/main/data/npm'
   */
  baseUrl?: string;
  /**
   * Custom fetch function (for testing or special environments)
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Time offset in milliseconds to adjust the client's "today" calculation.
   * Use this if the server clock is known to be off.
   * Positive values move time forward, negative values move it back.
   * @example
   * // Server clock is 2 hours behind UTC
   * new PricingClient({ timeOffsetMs: 2 * 60 * 60 * 1000 })
   */
  timeOffsetMs?: number;
  /**
   * External cache for persisting fetch timestamps across restarts/instances.
   * If not provided, uses in-memory cache (lost on restart).
   *
   * This prevents hammering GitHub when:
   * - Running in serverless (cold starts)
   * - Multiple server instances
   * - Server restarts
   *
   * @example
   * // Using a simple file-based cache
   * const cacheFile = './price-cache.json';
   * new PricingClient({
   *   externalCache: {
   *     get: async (key) => {
   *       try {
   *         const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
   *         return data[key];
   *       } catch { return undefined; }
   *     },
   *     set: async (key, value) => {
   *       let data = {};
   *       try { data = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
   *       data[key] = value;
   *       fs.writeFileSync(cacheFile, JSON.stringify(data));
   *     }
   *   }
   * });
   */
  externalCache?: {
    get: (key: string) => Promise<string | undefined> | string | undefined;
    set: (key: string, value: string) => Promise<void> | void;
  };
}

/**
 * Result of a price lookup
 */
export interface PriceLookupResult {
  /** The provider */
  provider: Provider;
  /** The model ID */
  modelId: string;
  /** The pricing data */
  pricing: ModelPricing;
  /** The date of the pricing data (YYYY-MM-DD) */
  date: string;
  /** True if the data is from a previous day (new data not yet available) */
  stale: boolean;
}

/**
 * Calculate cost result
 */
export interface CostResult {
  /** Cost for input tokens in USD */
  inputCost: number;
  /** Cost for output tokens in USD */
  outputCost: number;
  /** Total cost in USD */
  totalCost: number;
  /** Whether cached pricing was used for input */
  usedCachedPricing: boolean;
  /** The date of the pricing data used (YYYY-MM-DD) */
  date: string;
  /** True if the pricing data is from a previous day */
  stale: boolean;
}
