/**
 * Token Costs NPM Module Types
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
 * Built-in providers with remote data
 */
export type BuiltInProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

/**
 * Provider type - can be a built-in provider or a custom string
 */
export type Provider = BuiltInProvider | (string & {});

/**
 * Custom provider data format for offline/custom providers
 * Maps modelId to pricing data
 */
export type CustomProviderModels = Record<string, ModelPricing>;

/**
 * Options for the cost client
 */
export interface CostClientOptions {
  /**
   * When true, disables fetching from remote API.
   * Only customProviders data will be available.
   * @default false
   */
  offline?: boolean;

  /**
   * Custom provider data. Can be used to:
   * - Add custom/internal models not in the remote API
   * - Override pricing for existing models
   * - Provide all data locally (with offline: true)
   *
   * Custom data is merged with remote data (custom takes precedence).
   *
   * @example
   * ```ts
   * new CostClient({
   *   customProviders: {
   *     'my-company': {
   *       'internal-llm': { input: 0.50, output: 1.00, context: 32000 }
   *     },
   *     'openai': {
   *       'gpt-4-custom': { input: 25, output: 50 }  // Override/add to openai
   *     }
   *   }
   * });
   * ```
   */
  customProviders?: Record<string, CustomProviderModels>;

  /**
   * Base URL for fetching pricing data (ignored if offline: true)
   * @default 'https://raw.githubusercontent.com/mikkotikkanen/token-costs/main/docs/api/v1'
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
   * new CostClient({ timeOffsetMs: 2 * 60 * 60 * 1000 })
   */
  timeOffsetMs?: number;

  /**
   * External cache for persisting fetch timestamps across restarts/instances.
   * If not provided, uses in-memory cache (lost on restart).
   * Ignored if offline: true.
   *
   * This prevents hammering GitHub when:
   * - Running in serverless (cold starts)
   * - Multiple server instances
   * - Server restarts
   *
   * @example
   * // Using a simple file-based cache
   * const cacheFile = './price-cache.json';
   * new CostClient({
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
