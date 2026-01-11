import { BaseCrawler } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchJson, withRetry, sleep } from '../../utils/http.js';

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
 * Popular model prefixes to prioritize
 * This helps us avoid overwhelming OpenRouter with requests
 * and focuses on the most commonly used models
 */
const POPULAR_MODEL_PREFIXES = [
  'openai/',
  'anthropic/',
  'google/',
  'meta-llama/',
  'mistralai/',
  'deepseek/',
  'cohere/',
  'perplexity/',
  'qwen/',
  'microsoft/',
];

/**
 * Maximum number of models to include
 * Set to limit file size and API load
 */
const MAX_MODELS = 20;

/**
 * OpenRouter price crawler
 * Uses OpenRouter's public API to fetch model prices
 */
export class OpenRouterCrawler extends BaseCrawler {
  readonly provider: Provider = 'openrouter';
  readonly pricingUrl = 'https://openrouter.ai/models';
  readonly apiUrl = 'https://openrouter.ai/api/v1/models';

  async crawlPrices(): Promise<ModelPricing[]> {
    // OpenRouter provides a public API for model information
    const response = await withRetry(() =>
      fetchJson<OpenRouterModelsResponse>(this.apiUrl)
    );

    return this.parseApiResponse(response);
  }

  private parseApiResponse(response: OpenRouterModelsResponse): ModelPricing[] {
    const allModels = response.data
      .map(model => this.parseModel(model))
      .filter((m): m is ModelPricing => m !== null);

    // Sort models by popularity (popular prefixes first, then alphabetically)
    const sortedModels = this.sortByPopularity(allModels);

    // Return top N models to avoid overly large files
    const limitedModels = sortedModels.slice(0, MAX_MODELS);

    console.log(
      `[openrouter] Found ${allModels.length} total models, returning top ${limitedModels.length}`
    );

    return limitedModels;
  }

  private parseModel(model: OpenRouterModel): ModelPricing | null {
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

    return {
      modelId: model.id,
      modelName: model.name,
      inputPricePerMillion: Math.round(inputPricePerMillion * 1000000) / 1000000, // Round to 6 decimal places
      outputPricePerMillion: Math.round(outputPricePerMillion * 1000000) / 1000000,
      contextWindow: model.context_length,
      maxOutputTokens: model.top_provider?.max_completion_tokens,
      metadata: {
        description: model.description,
      },
    };
  }

  private sortByPopularity(models: ModelPricing[]): ModelPricing[] {
    return models.sort((a, b) => {
      const aPopularIndex = POPULAR_MODEL_PREFIXES.findIndex(prefix =>
        a.modelId.startsWith(prefix)
      );
      const bPopularIndex = POPULAR_MODEL_PREFIXES.findIndex(prefix =>
        b.modelId.startsWith(prefix)
      );

      // Both popular - sort by prefix order, then alphabetically
      if (aPopularIndex !== -1 && bPopularIndex !== -1) {
        if (aPopularIndex !== bPopularIndex) {
          return aPopularIndex - bPopularIndex;
        }
        return a.modelId.localeCompare(b.modelId);
      }

      // Only one is popular
      if (aPopularIndex !== -1) return -1;
      if (bPopularIndex !== -1) return 1;

      // Neither is popular - sort alphabetically
      return a.modelId.localeCompare(b.modelId);
    });
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

    const allModels = response.data
      .map(model => this.parseModel(model))
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

    return batchModels;
  }

  private parseModel(model: OpenRouterModel): ModelPricing | null {
    if (!model.pricing?.prompt || !model.pricing?.completion) {
      return null;
    }

    const inputPricePerToken = parseFloat(model.pricing.prompt);
    const outputPricePerToken = parseFloat(model.pricing.completion);

    if (
      isNaN(inputPricePerToken) ||
      isNaN(outputPricePerToken) ||
      (inputPricePerToken === 0 && outputPricePerToken === 0)
    ) {
      return null;
    }

    const inputPricePerMillion = inputPricePerToken * 1_000_000;
    const outputPricePerMillion = outputPricePerToken * 1_000_000;

    return {
      modelId: model.id,
      modelName: model.name,
      inputPricePerMillion: Math.round(inputPricePerMillion * 1000000) / 1000000,
      outputPricePerMillion: Math.round(outputPricePerMillion * 1000000) / 1000000,
      contextWindow: model.context_length,
      maxOutputTokens: model.top_provider?.max_completion_tokens,
    };
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
