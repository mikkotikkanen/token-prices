import { chromium, Browser, Page } from 'playwright';
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
 * Provider slugs to scrape for popularity data
 */
const PROVIDERS_TO_SCRAPE = [
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
 * Maximum models per provider (hard cap)
 */
const MAX_MODELS_PER_PROVIDER = 5;

/**
 * Minimum usage threshold relative to provider's top model.
 * Models must have at least this percentage of the top model's usage to be included.
 * E.g., 0.1 means a model needs 10% of the top model's tokens to qualify.
 */
const MIN_RELATIVE_USAGE = 0.1;

/**
 * Maximum total models to include
 */
const MAX_MODELS = 20;

/**
 * Scrape a provider page to get model usage stats
 */
async function scrapeProviderPopularity(
  browser: Browser,
  providerSlug: string
): Promise<Map<string, number>> {
  const page = await browser.newPage();
  const popularity = new Map<string, number>();

  try {
    console.log(`[openrouter] Scraping popularity for ${providerSlug}...`);
    await page.goto(`https://openrouter.ai/${providerSlug}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const models = await page.evaluate((provider) => {
      const results: { modelId: string; tokens: number }[] = [];
      const bodyText = (document.body as HTMLElement).innerText;
      const lines = bodyText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match usage pattern like "4.58B tokens", "22.9M tokens"
        const usageMatch = line.match(/^([\d.]+)([BMK])\s*tokens$/i);

        if (usageMatch) {
          const modelName = lines[i - 1];
          if (modelName && modelName.includes(':')) {
            let tokens = parseFloat(usageMatch[1]);
            const suffix = usageMatch[2].toUpperCase();

            if (suffix === 'B') tokens *= 1_000_000_000;
            else if (suffix === 'M') tokens *= 1_000_000;
            else if (suffix === 'K') tokens *= 1_000;

            // Find the model ID from links
            const links = Array.from(document.querySelectorAll(`a[href^="/${provider}/"]`)) as HTMLAnchorElement[];
            const searchText = modelName.split(':')[1]?.trim();
            const link = links.find((l: HTMLAnchorElement) => searchText && l.textContent?.includes(searchText));
            const href = link?.getAttribute('href');
            const modelId = href ? href.slice(1) : null;

            if (modelId) {
              results.push({ modelId, tokens });
            }
          }
        }
      }
      return results;
    }, providerSlug);

    // Dedupe and add to map
    const seen = new Set<string>();
    for (const m of models) {
      if (!seen.has(m.modelId)) {
        seen.add(m.modelId);
        popularity.set(m.modelId, m.tokens);
      }
    }
  } catch (error) {
    console.error(`[openrouter] Failed to scrape ${providerSlug}:`, error);
  } finally {
    await page.close();
  }

  return popularity;
}

/**
 * Scrape all provider pages for popularity data
 */
async function scrapeAllPopularity(): Promise<Map<string, number>> {
  const allPopularity = new Map<string, number>();
  const browser = await chromium.launch({ headless: true });

  try {
    for (const provider of PROVIDERS_TO_SCRAPE) {
      const providerPopularity = await scrapeProviderPopularity(browser, provider);
      for (const [modelId, tokens] of providerPopularity) {
        allPopularity.set(modelId, tokens);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`[openrouter] Scraped popularity for ${allPopularity.size} models`);
  return allPopularity;
}

/**
 * Parse a single OpenRouter model into our pricing format
 */
function parseOpenRouterModel(model: OpenRouterModel, includeMetadata = false): ModelPricing | null {
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

  if (includeMetadata && model.description) {
    pricing.metadata = { description: model.description };
  }

  return pricing;
}

/**
 * OpenRouter price crawler
 * Uses OpenRouter's public API for prices and scrapes provider pages for popularity
 */
export class OpenRouterCrawler extends BaseCrawler {
  readonly provider: Provider = 'openrouter';
  readonly pricingUrl = 'https://openrouter.ai/models';
  readonly apiUrl = 'https://openrouter.ai/api/v1/models';

  async crawlPrices(): Promise<ModelPricing[]> {
    // First, scrape popularity data from provider pages
    const popularity = await scrapeAllPopularity();

    // Then fetch prices from API
    const response = await withRetry(() =>
      fetchJson<OpenRouterModelsResponse>(this.apiUrl)
    );

    return this.selectTopModels(response, popularity);
  }

  private selectTopModels(
    response: OpenRouterModelsResponse,
    popularity: Map<string, number>
  ): ModelPricing[] {
    // Parse all models
    const allModels = response.data
      .map(model => parseOpenRouterModel(model, true))
      .filter((m): m is ModelPricing => m !== null);

    // Create a lookup map
    const modelMap = new Map(allModels.map(m => [m.modelId, m]));

    // Group popularity by provider and find top model per provider
    const providerTopTokens = new Map<string, number>();
    for (const [modelId, tokens] of popularity) {
      const provider = modelId.split('/')[0];
      const current = providerTopTokens.get(provider) || 0;
      if (tokens > current) {
        providerTopTokens.set(provider, tokens);
      }
    }

    // Sort models by popularity (tokens processed)
    const sortedByPopularity = Array.from(popularity.entries())
      .sort((a, b) => b[1] - a[1]);

    // Select models with drop-off heuristic
    const selectedModels: ModelPricing[] = [];
    const selectedIds = new Set<string>();
    const providerCounts = new Map<string, number>();

    for (const [modelId, tokens] of sortedByPopularity) {
      if (selectedModels.length >= MAX_MODELS) break;

      const model = modelMap.get(modelId);
      if (!model) continue;

      if (selectedIds.has(modelId)) continue;

      const provider = modelId.split('/')[0];
      const currentCount = providerCounts.get(provider) || 0;

      // Hard cap per provider
      if (currentCount >= MAX_MODELS_PER_PROVIDER) continue;

      // Drop-off heuristic: skip if usage is too low compared to provider's top model
      const topTokens = providerTopTokens.get(provider) || 0;
      const relativeUsage = topTokens > 0 ? tokens / topTokens : 0;

      if (relativeUsage < MIN_RELATIVE_USAGE) {
        const pct = (relativeUsage * 100).toFixed(1);
        console.log(`[openrouter] Skipping ${modelId} (only ${pct}% of top model's usage)`);
        continue;
      }

      selectedModels.push(model);
      selectedIds.add(modelId);
      providerCounts.set(provider, currentCount + 1);

      const tokensFormatted = tokens >= 1e9
        ? `${(tokens / 1e9).toFixed(1)}B`
        : `${(tokens / 1e6).toFixed(0)}M`;
      const pct = (relativeUsage * 100).toFixed(0);
      console.log(`[openrouter] Selected ${modelId} (${tokensFormatted} tokens, ${pct}% of top)`);
    }

    console.log(
      `[openrouter] Found ${allModels.length} total models, selected ${selectedModels.length} by popularity`
    );

    if (selectedModels.length === 0) {
      throw new Error('[openrouter] Could not select any models from API response');
    }

    return selectedModels;
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
