import * as cheerio from 'cheerio';
import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * OpenAI price crawler
 * Scrapes prices from OpenAI's platform pricing page (standard pricing section)
 */
export class OpenAICrawler extends BaseCrawler {
  readonly provider: Provider = 'openai';
  readonly pricingUrl = 'https://platform.openai.com/docs/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    const html = await withRetry(() => fetchHtml(this.pricingUrl));
    return this.parsePricingPage(html);
  }

  private parsePricingPage(html: string): ModelPricing[] {
    // The page has multiple pricing sections (priority, standard, batch, flex)
    // We want the "standard" section which starts with gpt-5.2 at $1.75 input
    // Format: <tr><td>MODEL</td><td>$INPUT</td><td>$CACHED</td><td>$OUTPUT</td></tr>

    const rowRegex = /<tr><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><\/tr>/g;

    let match;
    let inStandardSection = false;
    const models: ModelPricing[] = [];

    while ((match = rowRegex.exec(html)) !== null) {
      const modelName = match[1].trim();
      const inputStr = match[2].trim();
      const cachedStr = match[3].trim();
      const outputStr = match[4].trim();

      // Detect standard section by gpt-5.2 with $1.75 input
      if (modelName === 'gpt-5.2' && inputStr === '$1.75') {
        inStandardSection = true;
      }

      // Detect end of standard section (next section starts with same models but different prices)
      if (inStandardSection && modelName === 'gpt-5.2' && inputStr !== '$1.75') {
        break;
      }

      if (inStandardSection && modelName !== 'Model') {
        // Filter for text models only (exclude audio, image, realtime)
        if (this.isTextModel(modelName)) {
          const inputPrice = parsePrice(inputStr);
          const outputPrice = parsePrice(outputStr);
          const cachedPrice = cachedStr === '-' ? undefined : parsePrice(cachedStr);

          if (!isNaN(inputPrice) && !isNaN(outputPrice)) {
            models.push({
              modelId: this.normalizeModelId(modelName),
              modelName: modelName,
              inputPricePerMillion: inputPrice,
              outputPricePerMillion: outputPrice,
              cachedInputPricePerMillion: cachedPrice,
            });
          }
        }
      }
    }

    if (models.length === 0) {
      throw new Error('[openai] Could not parse any pricing from HTML');
    }

    if (models.length < 5) {
      throw new Error(`[openai] Only found ${models.length} models, expected at least 5`);
    }

    return models;
  }

  private isTextModel(name: string): boolean {
    const n = name.toLowerCase();

    // Include GPT and O-series text models
    const isText =
      n.startsWith('gpt-5') ||
      n.startsWith('gpt-4.1') ||
      n.startsWith('gpt-4o') ||
      /^o[134]/.test(n) ||
      n.startsWith('computer-use');

    // Exclude non-text variants
    const isExcluded = [
      'audio',
      'tts',
      'transcribe',
      'realtime',
      'image',
    ].some(x => n.includes(x));

    return isText && !isExcluded;
  }

  private normalizeModelId(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-\.]/g, '');
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
