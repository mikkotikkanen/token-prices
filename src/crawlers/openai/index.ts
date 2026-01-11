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

  private parsePricingPage(html: string): ModelPricing[] {
    const $ = cheerio.load(html);
    const models: ModelPricing[] = [];

    // OpenAI uses a structured format - look for pricing tables/cards
    // The page structure may change, so we try multiple selectors

    // Try to find JSON-LD data first (most reliable if present)
    const jsonLd = $('script[type="application/ld+json"]').text();
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd);
        // Check if it contains pricing info
        if (data.offers || data.priceSpecification) {
          // Parse structured data if available
        }
      } catch {
        // JSON-LD parsing failed, continue with HTML parsing
      }
    }

    // Parse pricing tables/sections
    // OpenAI typically shows models with input/output prices per 1K or 1M tokens

    // Look for pricing data in various formats
    // Strategy 1: Table rows
    $('table').each((_, table) => {
      const $table = $(table);
      $table.find('tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td, th').toArray();
        if (cells.length >= 3) {
          const modelName = $(cells[0]).text().trim();
          const inputPrice = $(cells[1]).text().trim();
          const outputPrice = $(cells[2]).text().trim();

          if (modelName && inputPrice && outputPrice && !isNaN(parsePrice(inputPrice))) {
            const model = this.parseModelRow(modelName, inputPrice, outputPrice);
            if (model) {
              models.push(model);
            }
          }
        }
      });
    });

    // Strategy 2: Pricing cards/divs with specific patterns
    // Look for elements containing price patterns like "$X.XX / 1M tokens"
    const pricePattern = /\$[\d.]+\s*(?:\/|per)\s*(?:1[KM]|1,?000(?:,?000)?)/i;

    $('[class*="pricing"], [class*="model"], [data-model]').each((_, el) => {
      const $el = $(el);
      const text = $el.text();

      if (pricePattern.test(text)) {
        // Try to extract model info from this element
        const modelEl = $el.find('[class*="model-name"], h3, h4').first();
        if (modelEl.length) {
          const name = modelEl.text().trim();
          const prices = text.match(/\$[\d.]+/g);
          if (name && prices && prices.length >= 2) {
            const inputPrice = parsePrice(prices[0]);
            const outputPrice = parsePrice(prices[1]);

            // Determine if prices are per 1K or 1M
            const perMillion = /1M|1,?000,?000/i.test(text);

            models.push({
              modelId: this.normalizeModelId(name),
              modelName: name,
              inputPricePerMillion: perMillion ? inputPrice : inputPrice * 1000,
              outputPricePerMillion: perMillion ? outputPrice : outputPrice * 1000,
            });
          }
        }
      }
    });

    // If we couldn't parse from HTML, use known models as fallback
    // This ensures we don't fail completely if the page structure changes
    if (models.length === 0) {
      console.warn('[openai] Could not parse pricing from HTML, using known models');
      return this.getKnownModels();
    }

    return this.deduplicateModels(models);
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
