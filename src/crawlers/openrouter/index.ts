import { BaseCrawler } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchJson, withRetry } from '../../utils/http.js';

/**
 * OpenRouter API model response
 */
interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
  context_length: number;
  top_provider?: {
    max_completion_tokens?: number;
  };
  per_request_limits?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

/**
 * Provider slugs to include models from.
 * All models from these providers will be crawled (no popularity filtering).
 */
const PROVIDERS_TO_INCLUDE = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'perplexity',
  'qwen',
  'moonshotai',
  'z-ai',
  'minimax',
  'x-ai',
];

/**
 * Parse a single OpenRouter model into our pricing format
 */
function parseOpenRouterModel(model: OpenRouterModel): ModelPricing | null {
  // Skip models with no pricing
  if (!model.pricing?.prompt || !model.pricing?.completion) {
    return null;
  }

  // Parse prices - OpenRouter returns prices per token as strings
  const inputPricePerToken = parseFloat(model.pricing.prompt);
  const outputPricePerToken = parseFloat(model.pricing.completion);

  // Skip free models or invalid prices
  if (
    isNaN(inputPricePerToken) ||
    isNaN(outputPricePerToken) ||
    (inputPricePerToken === 0 && outputPricePerToken === 0)
  ) {
    return null;
  }

  // Convert per-token price to per-million tokens
  const inputPricePerMillion = inputPricePerToken * 1_000_000;
  const outputPricePerMillion = outputPricePerToken * 1_000_000;

  const pricing: ModelPricing = {
    modelId: model.id,
    modelName: model.name,
    inputPricePerMillion: Math.round(inputPricePerMillion * 1000000) / 1000000, // Round to 6 decimal places
    outputPricePerMillion: Math.round(outputPricePerMillion * 1000000) / 1000000,
    contextWindow: model.context_length,
    maxOutputTokens: model.top_provider?.max_completion_tokens,
  };

  return pricing;
}

/**
 * OpenRouter price crawler
 * Fetches all models from selected providers via OpenRouter's public API
 */
export class OpenRouterCrawler extends BaseCrawler {
  readonly provider: Provider = 'openrouter';
  readonly pricingUrl = 'https://openrouter.ai/models';
  readonly apiUrl = 'https://openrouter.ai/api/v1/models';

  async crawlPrices(): Promise<ModelPricing[]> {
    const response = await withRetry(() =>
      fetchJson<OpenRouterModelsResponse>(this.apiUrl)
    );

    // Filter to only include models from selected providers
    const providerSet = new Set(PROVIDERS_TO_INCLUDE);

    const models = response.data
      .filter(model => {
        const provider = model.id.split('/')[0];
        return providerSet.has(provider);
      })
      .map(model => parseOpenRouterModel(model))
      .filter((m): m is ModelPricing => m !== null);

    // Log provider breakdown
    const providerCounts = new Map<string, number>();
    for (const model of models) {
      const provider = model.modelId.split('/')[0];
      providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1);
    }

    console.log(`[openrouter] Found ${response.data.length} total models in API`);
    console.log(`[openrouter] Selected ${models.length} models from ${providerCounts.size} providers:`);
    for (const [provider, count] of Array.from(providerCounts.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${provider}: ${count} models`);
    }

    if (models.length === 0) {
      throw new Error('[openrouter] No models found from selected providers');
    }

    return models;
  }
}

/**
 * OpenRouter crawler for a specific batch of models
 * Used for parallel processing in GitHub Actions
 */
export class OpenRouterBatchCrawler extends BaseCrawler {
  readonly provider: Provider = 'openrouter';
  readonly pricingUrl = 'https://openrouter.ai/models';
  readonly apiUrl = 'https://openrouter.ai/api/v1/models';

  constructor(
    private readonly batchIndex: number,
    private readonly totalBatches: number
  ) {
    super();
  }

  async crawlPrices(): Promise<ModelPricing[]> {
    const response = await withRetry(() =>
      fetchJson<OpenRouterModelsResponse>(this.apiUrl)
    );

    // Filter to only include models from selected providers
    const providerSet = new Set(PROVIDERS_TO_INCLUDE);

    const allModels = response.data
      .filter(model => {
        const provider = model.id.split('/')[0];
        return providerSet.has(provider);
      })
      .map(model => parseOpenRouterModel(model))
      .filter((m): m is ModelPricing => m !== null);

    // Calculate batch boundaries
    const batchSize = Math.ceil(allModels.length / this.totalBatches);
    const startIndex = this.batchIndex * batchSize;
    const endIndex = Math.min(startIndex + batchSize, allModels.length);

    const batchModels = allModels.slice(startIndex, endIndex);

    console.log(
      `[openrouter] Batch ${this.batchIndex + 1}/${this.totalBatches}: ` +
        `Processing models ${startIndex + 1}-${endIndex} of ${allModels.length}`
    );

    if (batchModels.length === 0) {
      throw new Error(`[openrouter] No models in batch ${this.batchIndex + 1}/${this.totalBatches}`);
    }

    return batchModels;
  }
}

// Run crawler if this is the main module
const scriptPath = process.argv[1];
if (scriptPath && scriptPath.includes('openrouter')) {
  // Check for batch arguments
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10);
  const totalBatches = parseInt(process.env.TOTAL_BATCHES || '1', 10);

  let crawler: BaseCrawler;

  if (totalBatches > 1) {
    console.log(`Running as batch ${batchIndex + 1} of ${totalBatches}`);
    crawler = new OpenRouterBatchCrawler(batchIndex, totalBatches);
  } else {
    crawler = new OpenRouterCrawler();
  }

  crawler.run().then(result => {
    if (!result.success) {
      console.error('Crawl failed:', result.error);
      process.exit(1);
    }
    console.log(`Successfully crawled ${result.prices.length} models`);
  });
}
