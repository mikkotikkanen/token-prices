/**
 * Represents pricing for a single model
 */
export interface ModelPricing {
  /** Model identifier */
  modelId: string;
  /** Human-readable model name */
  modelName: string;
  /** Price per 1M input tokens in USD */
  inputPricePerMillion: number;
  /** Price per 1M output tokens in USD */
  outputPricePerMillion: number;
  /** Price per 1M cached input tokens in USD (if supported) */
  cachedInputPricePerMillion?: number;
  /** Context window size in tokens (if available) */
  contextWindow?: number;
  /** Maximum output tokens (if available) */
  maxOutputTokens?: number;
  /** Any additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a price change event
 */
export interface PriceChange {
  /** ISO date string when this change was detected */
  date: string;
  /** Type of change */
  changeType: 'added' | 'removed' | 'updated';
  /** The model pricing data */
  pricing: ModelPricing;
  /** Previous pricing (for updates) */
  previousPricing?: ModelPricing;
}

/**
 * Provider price history file structure
 * Only stores changes to minimize file size
 */
export interface ProviderPriceHistory {
  /** Provider name */
  provider: string;
  /** Last time prices were crawled (ISO string) */
  lastCrawled: string;
  /** URL of the pricing page */
  pricingUrl: string;
  /** List of all price changes in chronological order */
  changes: PriceChange[];
}

/**
 * Current snapshot of all prices for a provider
 * Derived from applying all changes
 */
export interface ProviderPriceSnapshot {
  /** Provider name */
  provider: string;
  /** ISO date string */
  date: string;
  /** Current model prices */
  models: ModelPricing[];
}

/**
 * Crawler result
 */
export interface CrawlResult {
  /** Whether the crawl was successful */
  success: boolean;
  /** Provider name */
  provider: string;
  /** Prices found */
  prices: ModelPricing[];
  /** Error message if failed */
  error?: string;
  /** Timestamp of crawl */
  timestamp: string;
}

/**
 * Supported providers
 */
export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: Provider;
  pricingUrl: string;
  /** Whether this provider requires multiple crawl runs */
  requiresMultipleRuns?: boolean;
}
