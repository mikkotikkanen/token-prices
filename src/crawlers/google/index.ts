import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';
import { fetchHtml, withRetry } from '../../utils/http.js';

/**
 * Google/Gemini price crawler
 * Scrapes prices from Google AI's Gemini API pricing page using HTTP fetch
 * (Playwright approach didn't work well for this page's structure)
 */
export class GoogleCrawler extends BaseCrawler {
  readonly provider: Provider = 'google';
  readonly pricingUrl = 'https://ai.google.dev/gemini-api/docs/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    const html = await withRetry(() => fetchHtml(this.pricingUrl));
    return this.parsePricingPage(html);
  }

  private parsePricingPage(html: string): ModelPricing[] {
    const models: ModelPricing[] = [];
    const seenIds = new Set<string>();

    // Strategy 1: Find model sections by h2 headings with model names
    // Look for pattern: <h2...>Model Name</h2> followed by <code>model-id</code>
    // Then find the pricing table with Input price, Output price rows

    // Extract all model sections - each has an h2 heading followed by code element with model ID
    // Pattern: heading text, then <code>model-id</code>, then pricing table

    // Find all code elements that look like model IDs (gemini-*, gemma-*)
    const codeMatches = html.matchAll(/<code[^>]*>(gemini-[^<]+|gemma-[^<]+)<\/code>/gi);

    for (const codeMatch of codeMatches) {
      const modelId = codeMatch[1].trim();
      if (seenIds.has(modelId)) continue;

      // Find the position of this model ID in the HTML
      const codePos = codeMatch.index || 0;

      // Look backwards to find the h2 heading
      const beforeCode = html.substring(Math.max(0, codePos - 500), codePos);
      const h2Match = beforeCode.match(/<h2[^>]*>([^<]+)<\/h2>\s*$/i) ||
                      beforeCode.match(/<h2[^>]*>.*?([^>]+)<\/h2>\s*<em/i);

      // Look forward to find the pricing table (within next 5000 chars or until next h2)
      const afterCode = html.substring(codePos, Math.min(html.length, codePos + 5000));
      const nextH2Pos = afterCode.search(/<h2[^>]*>/i);
      const searchArea = nextH2Pos > 0 ? afterCode.substring(0, nextH2Pos) : afterCode;

      // Find pricing table
      const tableMatch = searchArea.match(/<table[\s\S]*?<\/table>/i);
      if (!tableMatch) continue;

      const table = tableMatch[0];

      // Extract prices from table
      // Table format: rows with "Input price", "Output price", "Context caching price"
      // Columns: [Label] | Free Tier | Paid Tier
      const inputMatch = table.match(/Input price[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>([^<]*\$[0-9.]+[^<]*)<\/td>/i);
      const outputMatch = table.match(/Output price[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>([^<]*\$[0-9.]+[^<]*)<\/td>/i);
      const cachingMatch = table.match(/(?:Context caching|caching) price[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>([^<]*\$[0-9.]+[^<]*)<\/td>/i);

      if (inputMatch && outputMatch) {
        const inputPrice = this.extractPrice(inputMatch[1]);
        const outputPrice = this.extractPrice(outputMatch[1]);
        const cachedPrice = cachingMatch ? this.extractPrice(cachingMatch[1]) : undefined;

        if (!isNaN(inputPrice) && !isNaN(outputPrice) && this.isTextModel(modelId)) {
          seenIds.add(modelId);
          models.push({
            modelId,
            modelName: modelId,
            inputPricePerMillion: inputPrice,
            outputPricePerMillion: outputPrice,
            cachedInputPricePerMillion: cachedPrice,
          });
        }
      }
    }

    console.log(`[google] Found ${models.length} text models`);

    if (models.length === 0) {
      throw new Error('[google] Could not parse any pricing from HTML');
    }

    if (models.length < 3) {
      throw new Error(`[google] Only found ${models.length} models, expected at least 3`);
    }

    return models;
  }

  private extractPrice(str: string): number {
    const match = str.match(/\$([0-9.]+)/);
    return match ? parseFloat(match[1]) : NaN;
  }

  private isTextModel(modelId: string): boolean {
    const n = modelId.toLowerCase();
    // Exclude non-text models
    const isExcluded = [
      'tts',
      'embedding',
      'robotics',
      'image',
      'imagen',
      'veo',
      'audio',
      'computer-use',
    ].some(x => n.includes(x));
    return !isExcluded;
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
