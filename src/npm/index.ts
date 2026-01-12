/**
 * Token Prices - Daily LLM pricing data
 *
 * @example
 * ```ts
 * import { getModelPricing, calculateCost } from 'token-prices';
 *
 * // Get pricing for a model
 * const result = await getModelPricing('openai', 'gpt-4o');
 * console.log(`Input: $${result.pricing.input}/M tokens`);
 * console.log(`Output: $${result.pricing.output}/M tokens`);
 *
 * // Calculate cost for an API call
 * const cost = await calculateCost('anthropic', 'claude-sonnet-4', {
 *   inputTokens: 1500,
 *   outputTokens: 800,
 * });
 * console.log(`Total cost: $${cost.totalCost.toFixed(6)}`);
 * ```
 *
 * @packageDocumentation
 */

// Re-export types
export type {
  ModelPricing,
  ProviderData,
  ProviderFile,
  Provider,
  PricingClientOptions,
  PriceLookupResult,
  CostResult,
} from './types.js';

// Re-export client
export {
  PricingClient,
  ClockMismatchError,
  getDefaultClient,
  getModelPricing,
  calculateCost,
} from './client.js';
