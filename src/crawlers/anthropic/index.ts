import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * Anthropic price crawler
 * Scrapes prices from Anthropic's platform pricing page
 */
export class AnthropicCrawler extends BaseCrawler {
  readonly provider: Provider = 'anthropic';
  readonly pricingUrl = 'https://platform.claude.com/docs/en/about-claude/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    const html = await withRetry(() => fetchHtml(this.pricingUrl));
    return this.parsePricingPage(html);
  }

  private parsePricingPage(html: string): ModelPricing[] {
    // Table format:
    // Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens
    // We want: Model (col 0), Base Input (col 1), Cache Hits (col 4), Output (col 5)
    // Note: Page has multiple tables (standard, batch) - we only want the first/standard pricing

    const models: ModelPricing[] = [];
    const seenModelIds = new Set<string>();

    // Match table rows with 6 columns
    // Format: <tr><td>Claude Opus 4.5</td><td>$5 / MTok</td><td>...</td><td>...</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
    const rowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const modelName = match[1].replace(/<[^>]+>/g, '').trim();
      const inputStr = match[2].replace(/<[^>]+>/g, '').trim();
      const cacheHitsStr = match[5].replace(/<[^>]+>/g, '').trim();
      const outputStr = match[6].replace(/<[^>]+>/g, '').trim();

      // Skip header rows
      if (modelName.toLowerCase().includes('model') || !modelName.toLowerCase().includes('claude')) {
        continue;
      }

      // Skip non-text models
      if (!this.isTextModel(modelName)) {
        continue;
      }

      const modelId = this.normalizeModelId(modelName);

      // Skip duplicates (batch pricing table has same models with different prices)
      if (seenModelIds.has(modelId)) {
        continue;
      }

      const inputPrice = this.extractPrice(inputStr);
      const outputPrice = this.extractPrice(outputStr);
      const cachedPrice = this.extractPrice(cacheHitsStr);

      if (!isNaN(inputPrice) && !isNaN(outputPrice)) {
        seenModelIds.add(modelId);
        models.push({
          modelId: modelId,
          modelName: modelName,
          inputPricePerMillion: inputPrice,
          outputPricePerMillion: outputPrice,
          cachedInputPricePerMillion: !isNaN(cachedPrice) ? cachedPrice : undefined,
        });
      }
    }

    if (models.length === 0) {
      throw new Error('[anthropic] Could not parse any pricing from HTML');
    }

    if (models.length < 3) {
      throw new Error(`[anthropic] Only found ${models.length} models, expected at least 3`);
    }

    return models;
  }

  private extractPrice(str: string): number {
    // Extract price from format like "$5 / MTok" or "$0.50 / MTok"
    const priceMatch = str.match(/\$([0-9.]+)/);
    if (priceMatch) {
      return parseFloat(priceMatch[1]);
    }
    return NaN;
  }

  private isTextModel(name: string): boolean {
    const n = name.toLowerCase();
    // Include Claude text models only
    const isExcluded = ['tts', 'embedding', 'image'].some(x => n.includes(x));
    return n.includes('claude') && !isExcluded;
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
