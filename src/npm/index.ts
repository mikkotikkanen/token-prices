/**
 * Token Costs - Daily LLM pricing data
 *
 * @example
 * ```ts
 * import { CostClient } from 'token-costs';
 *
 * // Create a client (fetches from remote API)
 * const client = new CostClient();
 *
 * // Get pricing for a model
 * const result = await client.getModelPricing('openai', 'gpt-4o');
 * console.log(`Input: $${result.pricing.input}/M tokens`);
 * console.log(`Output: $${result.pricing.output}/M tokens`);
 *
 * // Calculate cost for an API call
 * const cost = await client.calculateCost('anthropic', 'claude-sonnet-4', {
 *   inputTokens: 1500,
 *   outputTokens: 800,
 * });
 * console.log(`Total cost: $${cost.totalCost.toFixed(6)}`);
 *
 * // With custom providers
 * const customClient = new CostClient({
 *   customProviders: {
 *     'my-company': {
 *       'internal-llm': { input: 0.50, output: 1.00 }
 *     }
 *   }
 * });
 *
 * // Offline mode (no remote fetching)
 * const offlineClient = new CostClient({
 *   offline: true,
 *   customProviders: { ... }
 * });
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
  BuiltInProvider,
  CostClientOptions,
  PriceLookupResult,
  CostResult,
  CustomProviderModels,
  DeprecationInfo,
} from './types.js';

// Re-export client
export { CostClient, ClockMismatchError } from './client.js';
