import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * Google/Gemini price crawler
 * Scrapes prices from Google AI's Gemini API pricing page
 */
export class GoogleCrawler extends BaseCrawler {
  readonly provider: Provider = 'google';
  readonly pricingUrl = 'https://ai.google.dev/gemini-api/docs/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    try {
      const html = await withRetry(() => fetchHtml(this.pricingUrl));
      return this.parsePricingPage(html);
    } catch (error) {
      console.warn(`[google] Fetch failed: ${error instanceof Error ? error.message : error}`);
      console.warn('[google] Using fallback known models');
      return this.getKnownModels();
    }
  }

  private parsePricingPage(html: string): ModelPricing[] {
    // Page structure: each model has an h2 with id="gemini-{model-name}"
    // followed by a pricing table with rows for Input price, Output price, Context caching price
    // We extract from the "Paid Tier" column

    const sections = html.split(/<h2[^>]*id="gemini-/);
    const models: ModelPricing[] = [];

    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      const idMatch = section.match(/^([^"]+)"/);
      if (!idMatch) continue;

      const modelId = 'gemini-' + idMatch[1];

      // Skip non-model IDs (CSS classes, images, etc.)
      if (modelId.includes('api-') || modelId.includes('.svg') || modelId.includes('.png')) continue;

      // Get content until next h2
      const content = section.substring(0, section.indexOf('<h2') > 0 ? section.indexOf('<h2') : 10000);

      // Find the pricing table
      const tableMatch = content.match(/<table[\s\S]*?<\/table>/);
      if (!tableMatch) continue;

      const table = tableMatch[0];

      // Extract prices from "Paid Tier" column (second td in each row)
      const inputMatch = table.match(/Input price[\s\S]*?<td[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
      const outputMatch = table.match(/Output price[\s\S]*?<td[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
      const cachingMatch = table.match(/Context caching price[\s\S]*?<td[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);

      if (inputMatch && outputMatch) {
        const inputCell = inputMatch[1].replace(/<[^>]+>/g, '');
        const outputCell = outputMatch[1].replace(/<[^>]+>/g, '');
        const cachingCell = cachingMatch ? cachingMatch[1].replace(/<[^>]+>/g, '') : '';

        const inputPrice = inputCell.match(/\$([0-9.]+)/);
        const outputPrice = outputCell.match(/\$([0-9.]+)/);
        const cachingPrice = cachingCell.match(/\$([0-9.]+)/);

        if (inputPrice && outputPrice && this.isTextModel(modelId)) {
          models.push({
            modelId: modelId,
            modelName: modelId,
            inputPricePerMillion: parseFloat(inputPrice[1]),
            outputPricePerMillion: parseFloat(outputPrice[1]),
            cachedInputPricePerMillion: cachingPrice ? parseFloat(cachingPrice[1]) : undefined,
          });
        }
      }
    }

    if (models.length === 0) {
      console.warn('[google] Could not parse pricing from HTML, using known models');
      return this.getKnownModels();
    }

    if (models.length < 3) {
      console.warn(`[google] Only found ${models.length} models, using known models instead`);
      return this.getKnownModels();
    }

    return models;
  }

  private isTextModel(modelId: string): boolean {
    const n = modelId.toLowerCase();
    // Exclude TTS, embedding, robotics, image-only models
    const isExcluded = ['tts', 'embedding', 'robotics', 'image-preview'].some(x => n.includes(x));
    return !isExcluded;
  }

  /**
   * Known Google Gemini models as fallback
   */
  private getKnownModels(): ModelPricing[] {
    return [
      {
        modelId: 'gemini-3-pro-preview',
        modelName: 'gemini-3-pro-preview',
        inputPricePerMillion: 2.00,
        outputPricePerMillion: 12.00,
        cachedInputPricePerMillion: 0.20,
      },
      {
        modelId: 'gemini-3-flash-preview',
        modelName: 'gemini-3-flash-preview',
        inputPricePerMillion: 0.50,
        outputPricePerMillion: 3.00,
        cachedInputPricePerMillion: 0.05,
      },
      {
        modelId: 'gemini-2.5-pro',
        modelName: 'gemini-2.5-pro',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.00,
        cachedInputPricePerMillion: 0.125,
      },
      {
        modelId: 'gemini-2.5-flash',
        modelName: 'gemini-2.5-flash',
        inputPricePerMillion: 0.30,
        outputPricePerMillion: 2.50,
        cachedInputPricePerMillion: 0.03,
      },
      {
        modelId: 'gemini-2.5-flash-lite',
        modelName: 'gemini-2.5-flash-lite',
        inputPricePerMillion: 0.10,
        outputPricePerMillion: 0.40,
        cachedInputPricePerMillion: 0.01,
      },
      {
        modelId: 'gemini-2.0-flash',
        modelName: 'gemini-2.0-flash',
        inputPricePerMillion: 0.10,
        outputPricePerMillion: 0.40,
        cachedInputPricePerMillion: 0.025,
      },
      {
        modelId: 'gemini-2.0-flash-lite',
        modelName: 'gemini-2.0-flash-lite',
        inputPricePerMillion: 0.075,
        outputPricePerMillion: 0.30,
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
