import { CrawlResult, ModelPricing, Provider } from '../types.js';
import { updateProviderPrices } from '../utils/storage.js';

/**
 * Base class for all price crawlers
 */
export abstract class BaseCrawler {
  abstract readonly provider: Provider;
  abstract readonly pricingUrl: string;

  /**
   * Crawl prices from the provider's pricing page
   * Subclasses must implement this
   */
  abstract crawlPrices(): Promise<ModelPricing[]>;

  /**
   * Run the crawler and update storage
   */
  async run(): Promise<CrawlResult> {
    const timestamp = new Date().toISOString();
    console.log(`[${this.provider}] Starting price crawl at ${timestamp}`);
    console.log(`[${this.provider}] Pricing URL: ${this.pricingUrl}`);

    try {
      const prices = await this.crawlPrices();
      console.log(`[${this.provider}] Found ${prices.length} models`);

      const changes = await updateProviderPrices(
        this.provider,
        this.pricingUrl,
        prices
      );

      if (changes.length > 0) {
        console.log(`[${this.provider}] Detected ${changes.length} price changes:`);
        for (const change of changes) {
          console.log(`  - ${change.changeType}: ${change.pricing.modelId}`);
          if (change.changeType === 'updated' && change.previousPricing) {
            console.log(
              `    Input: $${change.previousPricing.inputPricePerMillion} -> $${change.pricing.inputPricePerMillion}/1M`
            );
            console.log(
              `    Output: $${change.previousPricing.outputPricePerMillion} -> $${change.pricing.outputPricePerMillion}/1M`
            );
          }
        }
      } else {
        console.log(`[${this.provider}] No price changes detected`);
      }

      return {
        success: true,
        provider: this.provider,
        prices,
        timestamp,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[${this.provider}] Crawl failed: ${errorMessage}`);

      return {
        success: false,
        provider: this.provider,
        prices: [],
        error: errorMessage,
        timestamp,
      };
    }
  }
}

/**
 * Parse a price string like "$0.50" or "0.50" to a number
 * Extracts the first price-like number from the string
 */
export function parsePrice(priceStr: string): number {
  // First try to match a price pattern like $1.00 or 1.00
  const priceMatch = priceStr.match(/\$?\s*(-?[\d,]+(?:\.\d+)?)/);
  if (priceMatch) {
    // Remove commas and parse
    return parseFloat(priceMatch[1].replace(/,/g, ''));
  }
  // Fallback: remove $ and any other non-numeric characters except . and -
  const cleaned = priceStr.replace(/[^0-9.\-]/g, '');
  return parseFloat(cleaned);
}

/**
 * Convert price per 1K tokens to price per 1M tokens
 */
export function pricePerKToPerM(pricePerK: number): number {
  return pricePerK * 1000;
}

/**
 * Convert price per token to price per 1M tokens
 */
export function pricePerTokenToPerM(pricePerToken: number): number {
  return pricePerToken * 1_000_000;
}
