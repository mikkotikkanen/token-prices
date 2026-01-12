import * as cheerio from 'cheerio';
import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * OpenAI price crawler
 * Scrapes prices from OpenAI's pricing page
 */
export class OpenAICrawler extends BaseCrawler {
  readonly provider: Provider = 'openai';
  readonly pricingUrl = 'https://openai.com/api/pricing/';

  async crawlPrices(): Promise<ModelPricing[]> {
    try {
      const html = await withRetry(() => fetchHtml(this.pricingUrl));
      return this.parsePricingPage(html);
    } catch (error) {
      // If fetch fails (e.g., 403 forbidden), fall back to known models
      console.warn(`[openai] Fetch failed: ${error instanceof Error ? error.message : error}`);
      console.warn('[openai] Using fallback known models');
      return this.getKnownModels();
    }
  }

  // Known model patterns to validate parsed results
  private readonly KNOWN_MODEL_PATTERNS = [
    /^gpt-[34]/i,
    /^o[13]-/i,
    /^o[13]$/i,
    /^davinci/i,
    /^babbage/i,
    /^ada/i,
    /^curie/i,
    /^text-/i,
    /^code-/i,
  ];

  private isValidModelName(name: string): boolean {
    const normalized = name.toLowerCase().trim();
    // Must match a known pattern
    if (!this.KNOWN_MODEL_PATTERNS.some(p => p.test(normalized))) {
      return false;
    }
    // Must not be too long (garbage text)
    if (normalized.length > 30) {
      return false;
    }
    // Must not contain certain words that indicate non-model content
    const invalidWords = ['price', 'pricing', 'fine-tuning', 'training', 'cost', 'tier', 'text'];
    if (invalidWords.some(w => normalized === w)) {
      return false;
    }
    return true;
  }

  private parsePricingPage(html: string): ModelPricing[] {
    const $ = cheerio.load(html);
    const models: ModelPricing[] = [];

    // Strategy 1: Look for table rows with model pricing
    $('table').each((_, table) => {
      const $table = $(table);
      $table.find('tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td, th').toArray();
        if (cells.length >= 3) {
          const modelName = $(cells[0]).text().trim();
          const inputPrice = $(cells[1]).text().trim();
          const outputPrice = $(cells[2]).text().trim();

          if (modelName && this.isValidModelName(modelName) && !isNaN(parsePrice(inputPrice))) {
            const model = this.parseModelRow(modelName, inputPrice, outputPrice);
            if (model) {
              models.push(model);
            }
          }
        }
      });
    });

    // Validate results - if we got suspicious data, fall back
    const validModels = models.filter(m => this.isValidModelName(m.modelName));

    if (validModels.length === 0) {
      console.warn('[openai] Could not parse valid pricing from HTML, using known models');
      return this.getKnownModels();
    }

    // If we got fewer than 3 models, something is probably wrong
    if (validModels.length < 3) {
      console.warn(`[openai] Only found ${validModels.length} models, using known models instead`);
      return this.getKnownModels();
    }

    return this.deduplicateModels(validModels);
  }

  private parseModelRow(
    modelName: string,
    inputPriceStr: string,
    outputPriceStr: string
  ): ModelPricing | null {
    const inputPrice = parsePrice(inputPriceStr);
    const outputPrice = parsePrice(outputPriceStr);

    if (isNaN(inputPrice) || isNaN(outputPrice)) {
      return null;
    }

    // Check if prices are per 1K or 1M tokens
    const isPerMillion =
      inputPriceStr.includes('1M') ||
      inputPriceStr.includes('million') ||
      inputPriceStr.includes('1,000,000');

    return {
      modelId: this.normalizeModelId(modelName),
      modelName: modelName,
      inputPricePerMillion: isPerMillion ? inputPrice : inputPrice * 1000,
      outputPricePerMillion: isPerMillion ? outputPrice : outputPrice * 1000,
    };
  }

  private normalizeModelId(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-\.]/g, '');
  }

  private deduplicateModels(models: ModelPricing[]): ModelPricing[] {
    const seen = new Map<string, ModelPricing>();
    for (const model of models) {
      if (!seen.has(model.modelId)) {
        seen.set(model.modelId, model);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Known OpenAI models as fallback
   * These are updated periodically when the crawler runs successfully
   */
  private getKnownModels(): ModelPricing[] {
    return [
      {
        modelId: 'gpt-4o',
        modelName: 'GPT-4o',
        inputPricePerMillion: 2.50,
        outputPricePerMillion: 10.00,
        contextWindow: 128000,
      },
      {
        modelId: 'gpt-4o-mini',
        modelName: 'GPT-4o mini',
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.60,
        contextWindow: 128000,
      },
      {
        modelId: 'gpt-4-turbo',
        modelName: 'GPT-4 Turbo',
        inputPricePerMillion: 10.00,
        outputPricePerMillion: 30.00,
        contextWindow: 128000,
      },
      {
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        inputPricePerMillion: 30.00,
        outputPricePerMillion: 60.00,
        contextWindow: 8192,
      },
      {
        modelId: 'gpt-3.5-turbo',
        modelName: 'GPT-3.5 Turbo',
        inputPricePerMillion: 0.50,
        outputPricePerMillion: 1.50,
        contextWindow: 16385,
      },
      {
        modelId: 'o1',
        modelName: 'o1',
        inputPricePerMillion: 15.00,
        outputPricePerMillion: 60.00,
        contextWindow: 200000,
      },
      {
        modelId: 'o1-mini',
        modelName: 'o1-mini',
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 12.00,
        contextWindow: 128000,
      },
      {
        modelId: 'o1-pro',
        modelName: 'o1-pro',
        inputPricePerMillion: 150.00,
        outputPricePerMillion: 600.00,
        contextWindow: 200000,
      },
      {
        modelId: 'o3-mini',
        modelName: 'o3-mini',
        inputPricePerMillion: 1.10,
        outputPricePerMillion: 4.40,
        contextWindow: 200000,
      },
    ];
  }
}

// Run crawler if this is the main module
const scriptPath = process.argv[1];
if (scriptPath && scriptPath.includes('openai')) {
  const crawler = new OpenAICrawler();
  crawler.run().then(result => {
    if (!result.success) {
      console.error('Crawl failed:', result.error);
      process.exit(1);
    }
    console.log(`Successfully crawled ${result.prices.length} models`);
  });
}
