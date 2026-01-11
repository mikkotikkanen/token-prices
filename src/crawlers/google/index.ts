import * as cheerio from 'cheerio';
import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * Google/Gemini price crawler
 * Scrapes prices from Google AI's pricing page
 */
export class GoogleCrawler extends BaseCrawler {
  readonly provider: Provider = 'google';
  readonly pricingUrl = 'https://ai.google.dev/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    try {
      const html = await withRetry(() => fetchHtml(this.pricingUrl));
      return this.parsePricingPage(html);
    } catch (error) {
      // If fetch fails (e.g., 403 forbidden), fall back to known models
      console.warn(`[google] Fetch failed: ${error instanceof Error ? error.message : error}`);
      console.warn('[google] Using fallback known models');
      return this.getKnownModels();
    }
  }

  private parsePricingPage(html: string): ModelPricing[] {
    const $ = cheerio.load(html);
    const models: ModelPricing[] = [];

    // Google AI typically shows pricing in tables
    $('table').each((_, table) => {
      const $table = $(table);
      const headers = $table.find('th').toArray().map(th => $(th).text().trim().toLowerCase());

      // Try to identify pricing columns
      const hasInputOutput =
        headers.some(h => h.includes('input')) && headers.some(h => h.includes('output'));

      if (hasInputOutput) {
        $table.find('tbody tr').each((_, row) => {
          const cells = $(row).find('td').toArray();
          const cellTexts = cells.map(cell => $(cell).text().trim());

          // Try to find model name and prices
          const modelName = this.extractModelName(cellTexts);
          const prices = this.extractPrices(cellTexts);

          if (modelName && prices) {
            models.push({
              modelId: this.normalizeModelId(modelName),
              modelName: modelName,
              inputPricePerMillion: prices.input,
              outputPricePerMillion: prices.output,
            });
          }
        });
      }
    });

    // Also look for pricing in definition lists or cards
    $('dl, [class*="pricing"]').each((_, el) => {
      const text = $(el).text();
      const geminiMatch = text.match(/Gemini\s*[\d.]+(?:\s*(?:Pro|Flash|Ultra|Nano))?/gi);

      if (geminiMatch) {
        for (const modelName of geminiMatch) {
          const contextText = $(el).text();
          const prices = contextText.match(/\$[\d.]+/g);

          if (prices && prices.length >= 2) {
            const inputPrice = parsePrice(prices[0]);
            const outputPrice = parsePrice(prices[1]);
            const perMillion = /million|1M/i.test(contextText);

            models.push({
              modelId: this.normalizeModelId(modelName),
              modelName: modelName.trim(),
              inputPricePerMillion: perMillion ? inputPrice : inputPrice * 1000,
              outputPricePerMillion: perMillion ? outputPrice : outputPrice * 1000,
            });
          }
        }
      }
    });

    // If we couldn't parse from HTML, use known models as fallback
    if (models.length === 0) {
      console.warn('[google] Could not parse pricing from HTML, using known models');
      return this.getKnownModels();
    }

    return this.deduplicateModels(models);
  }

  private extractModelName(cells: string[]): string | null {
    for (const cell of cells) {
      // Look for Gemini model names
      if (/gemini/i.test(cell)) {
        return cell.split(/[\n\r]/)[0].trim();
      }
    }
    return cells[0] || null;
  }

  private extractPrices(cells: string[]): { input: number; output: number } | null {
    const prices: number[] = [];

    for (const cell of cells) {
      const match = cell.match(/\$?([\d.]+)/);
      if (match) {
        const price = parseFloat(match[1]);
        if (!isNaN(price)) {
          prices.push(price);
        }
      }
    }

    if (prices.length >= 2) {
      // Assume first price is input, second is output
      // Prices are typically per 1M tokens for Google
      return {
        input: prices[0],
        output: prices[1],
      };
    }

    return null;
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
   * Known Google Gemini models as fallback
   */
  private getKnownModels(): ModelPricing[] {
    return [
      {
        modelId: 'gemini-2.0-flash',
        modelName: 'Gemini 2.0 Flash',
        inputPricePerMillion: 0.10,
        outputPricePerMillion: 0.40,
        contextWindow: 1000000,
      },
      {
        modelId: 'gemini-2.0-flash-thinking',
        modelName: 'Gemini 2.0 Flash Thinking',
        inputPricePerMillion: 0.10,
        outputPricePerMillion: 0.40,
        contextWindow: 1000000,
      },
      {
        modelId: 'gemini-1.5-pro',
        modelName: 'Gemini 1.5 Pro',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 5.00,
        contextWindow: 2000000,
      },
      {
        modelId: 'gemini-1.5-flash',
        modelName: 'Gemini 1.5 Flash',
        inputPricePerMillion: 0.075,
        outputPricePerMillion: 0.30,
        contextWindow: 1000000,
      },
      {
        modelId: 'gemini-1.5-flash-8b',
        modelName: 'Gemini 1.5 Flash-8B',
        inputPricePerMillion: 0.0375,
        outputPricePerMillion: 0.15,
        contextWindow: 1000000,
      },
      {
        modelId: 'gemini-1.0-pro',
        modelName: 'Gemini 1.0 Pro',
        inputPricePerMillion: 0.50,
        outputPricePerMillion: 1.50,
        contextWindow: 32000,
      },
    ];
  }
}

// Run crawler if this is the main module
const scriptPath = process.argv[1];
if (scriptPath && scriptPath.includes('google')) {
  const crawler = new GoogleCrawler();
  crawler.run().then(result => {
    if (!result.success) {
      console.error('Crawl failed:', result.error);
      process.exit(1);
    }
    console.log(`Successfully crawled ${result.prices.length} models`);
  });
}
