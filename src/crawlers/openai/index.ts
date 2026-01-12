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
    try {
      const html = await withRetry(() => fetchHtml(this.pricingUrl));
      return this.parsePricingPage(html);
    } catch (error) {
      console.warn(`[openai] Fetch failed: ${error instanceof Error ? error.message : error}`);
      console.warn('[openai] Using fallback known models');
      return this.getKnownModels();
    }
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
      console.warn('[openai] Could not parse pricing from HTML, using known models');
      return this.getKnownModels();
    }

    if (models.length < 5) {
      console.warn(`[openai] Only found ${models.length} models, using known models instead`);
      return this.getKnownModels();
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

  /**
   * Known OpenAI models as fallback (standard pricing)
   */
  private getKnownModels(): ModelPricing[] {
    return [
      {
        modelId: 'gpt-5.2',
        modelName: 'gpt-5.2',
        inputPricePerMillion: 1.75,
        cachedInputPricePerMillion: 0.175,
        outputPricePerMillion: 14.00,
      },
      {
        modelId: 'gpt-5.1',
        modelName: 'gpt-5.1',
        inputPricePerMillion: 1.25,
        cachedInputPricePerMillion: 0.125,
        outputPricePerMillion: 10.00,
      },
      {
        modelId: 'gpt-5',
        modelName: 'gpt-5',
        inputPricePerMillion: 1.25,
        cachedInputPricePerMillion: 0.125,
        outputPricePerMillion: 10.00,
      },
      {
        modelId: 'gpt-5-mini',
        modelName: 'gpt-5-mini',
        inputPricePerMillion: 0.25,
        cachedInputPricePerMillion: 0.025,
        outputPricePerMillion: 2.00,
      },
      {
        modelId: 'gpt-5-nano',
        modelName: 'gpt-5-nano',
        inputPricePerMillion: 0.05,
        cachedInputPricePerMillion: 0.005,
        outputPricePerMillion: 0.40,
      },
      {
        modelId: 'gpt-4.1',
        modelName: 'gpt-4.1',
        inputPricePerMillion: 2.00,
        cachedInputPricePerMillion: 0.50,
        outputPricePerMillion: 8.00,
      },
      {
        modelId: 'gpt-4.1-mini',
        modelName: 'gpt-4.1-mini',
        inputPricePerMillion: 0.40,
        cachedInputPricePerMillion: 0.10,
        outputPricePerMillion: 1.60,
      },
      {
        modelId: 'gpt-4.1-nano',
        modelName: 'gpt-4.1-nano',
        inputPricePerMillion: 0.10,
        cachedInputPricePerMillion: 0.025,
        outputPricePerMillion: 0.40,
      },
      {
        modelId: 'gpt-4o',
        modelName: 'gpt-4o',
        inputPricePerMillion: 2.50,
        cachedInputPricePerMillion: 1.25,
        outputPricePerMillion: 10.00,
      },
      {
        modelId: 'gpt-4o-mini',
        modelName: 'gpt-4o-mini',
        inputPricePerMillion: 0.15,
        cachedInputPricePerMillion: 0.075,
        outputPricePerMillion: 0.60,
      },
      {
        modelId: 'o1',
        modelName: 'o1',
        inputPricePerMillion: 15.00,
        cachedInputPricePerMillion: 7.50,
        outputPricePerMillion: 60.00,
      },
      {
        modelId: 'o1-mini',
        modelName: 'o1-mini',
        inputPricePerMillion: 1.10,
        cachedInputPricePerMillion: 0.55,
        outputPricePerMillion: 4.40,
      },
      {
        modelId: 'o3',
        modelName: 'o3',
        inputPricePerMillion: 2.00,
        cachedInputPricePerMillion: 0.50,
        outputPricePerMillion: 8.00,
      },
      {
        modelId: 'o3-mini',
        modelName: 'o3-mini',
        inputPricePerMillion: 1.10,
        cachedInputPricePerMillion: 0.55,
        outputPricePerMillion: 4.40,
      },
      {
        modelId: 'o4-mini',
        modelName: 'o4-mini',
        inputPricePerMillion: 1.10,
        cachedInputPricePerMillion: 0.275,
        outputPricePerMillion: 4.40,
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
