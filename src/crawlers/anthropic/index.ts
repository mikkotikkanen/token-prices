import * as cheerio from 'cheerio';
import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * Anthropic price crawler
 * Scrapes prices from Anthropic's pricing page
 */
export class AnthropicCrawler extends BaseCrawler {
  readonly provider: Provider = 'anthropic';
  readonly pricingUrl = 'https://www.anthropic.com/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    const html = await withRetry(() => fetchHtml(this.pricingUrl));
    return this.parsePricingPage(html);
  }

  private parsePricingPage(html: string): ModelPricing[] {
    const $ = cheerio.load(html);
    const models: ModelPricing[] = [];

    // Try to find pricing data in the page
    // Anthropic typically displays pricing in tables or cards

    // Strategy 1: Look for table-based pricing
    $('table').each((_, table) => {
      const $table = $(table);
      const headers = $table.find('th').toArray().map(th => $(th).text().trim().toLowerCase());

      // Find column indices
      const modelCol = headers.findIndex(h => h.includes('model'));
      const inputCol = headers.findIndex(h => h.includes('input'));
      const outputCol = headers.findIndex(h => h.includes('output'));

      if (inputCol !== -1 && outputCol !== -1) {
        $table.find('tbody tr').each((_, row) => {
          const cells = $(row).find('td').toArray();
          if (cells.length > Math.max(modelCol, inputCol, outputCol)) {
            const modelName = $(cells[modelCol >= 0 ? modelCol : 0]).text().trim();
            const inputPriceStr = $(cells[inputCol]).text().trim();
            const outputPriceStr = $(cells[outputCol]).text().trim();

            const model = this.parseModelPricing(modelName, inputPriceStr, outputPriceStr);
            if (model) {
              models.push(model);
            }
          }
        });
      }
    });

    // Strategy 2: Look for pricing cards with model names
    $('[class*="pricing"], [class*="model"], [class*="card"]').each((_, el) => {
      const $el = $(el);
      const text = $el.text();

      // Look for Claude model names
      const claudeMatch = text.match(/Claude\s*(?:[\d.]+\s*)?(?:Opus|Sonnet|Haiku|Instant)/i);
      if (claudeMatch) {
        const prices = text.match(/\$[\d.]+/g);
        if (prices && prices.length >= 2) {
          const inputPrice = parsePrice(prices[0]);
          const outputPrice = parsePrice(prices[1]);

          // Check if per million
          const perMillion = /\/\s*M|per\s*M|MTok/i.test(text);

          models.push({
            modelId: this.normalizeModelId(claudeMatch[0]),
            modelName: claudeMatch[0],
            inputPricePerMillion: perMillion ? inputPrice : inputPrice * 1000,
            outputPricePerMillion: perMillion ? outputPrice : outputPrice * 1000,
          });
        }
      }
    });

    if (models.length === 0) {
      throw new Error('[anthropic] Could not parse any pricing from HTML');
    }

    return this.deduplicateModels(models);
  }

  private parseModelPricing(
    modelName: string,
    inputPriceStr: string,
    outputPriceStr: string
  ): ModelPricing | null {
    // Skip non-model rows
    if (!modelName || modelName.toLowerCase().includes('model')) {
      return null;
    }

    const inputPrice = parsePrice(inputPriceStr);
    const outputPrice = parsePrice(outputPriceStr);

    if (isNaN(inputPrice) || isNaN(outputPrice)) {
      return null;
    }

    // Determine price scale (per 1K or 1M)
    const isPerMillion =
      inputPriceStr.includes('M') ||
      inputPriceStr.includes('million') ||
      inputPrice < 1; // If price is < $1, it's likely per 1M

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
}

// Run crawler if this is the main module
const scriptPath = process.argv[1];
if (scriptPath && scriptPath.includes('anthropic')) {
  const crawler = new AnthropicCrawler();
  crawler.run().then(result => {
    if (!result.success) {
      console.error('Crawl failed:', result.error);
      process.exit(1);
    }
    console.log(`Successfully crawled ${result.prices.length} models`);
  });
}
