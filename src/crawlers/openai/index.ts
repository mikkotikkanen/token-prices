import { chromium } from 'playwright';
import { BaseCrawler, parsePrice } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';

/**
 * OpenAI price crawler
 * Uses Playwright to scrape prices from OpenAI's platform pricing page
 */
export class OpenAICrawler extends BaseCrawler {
  readonly provider: Provider = 'openai';
  readonly pricingUrl = 'https://platform.openai.com/docs/pricing';

  async crawlPrices(): Promise<ModelPricing[]> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      await page.goto(this.pricingUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // Wait for the pricing table to load (may need extra time due to JS)
      // Use waitForFunction to wait for table to exist in DOM (not just visible)
      await page.waitForFunction(() => document.querySelectorAll('table').length > 0, { timeout: 30000 });
      // Extra wait for JS to finish rendering
      await page.waitForTimeout(2000);

      // Extract pricing data from the "Text tokens" section
      // Strategy: Find the first table with columns Model|Input|Cached input|Output
      const models = await page.evaluate(() => {
        const results: {
          modelId: string;
          modelName: string;
          input: number;
          output: number;
          cached?: number;
        }[] = [];

        // Helper to parse price string like "$1.75" or "$0.175" to number
        const parsePrice = (str: string): number => {
          const match = str.match(/\$([0-9.]+)/);
          return match ? parseFloat(match[1]) : NaN;
        };

        // Find all tables and look for one with the right header structure
        const tables = Array.from(document.querySelectorAll('table'));

        for (const table of tables) {
          const headerRow = table.querySelector('thead tr, tr');
          if (!headerRow) continue;

          const headers = Array.from(headerRow.querySelectorAll('th, td'))
            .map(h => h.textContent?.toLowerCase().trim() || '');

          // Look for text token table: Model | Input | Cached input | Output
          const hasModel = headers.some(h => h.includes('model'));
          const hasInput = headers.some(h => h === 'input');
          const hasCached = headers.some(h => h.includes('cached'));
          const hasOutput = headers.some(h => h === 'output');

          if (!hasModel || !hasInput || !hasOutput) continue;

          // Parse all rows from this table
          const rows = Array.from(table.querySelectorAll('tbody tr'));
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) continue;

            const modelName = cells[0].textContent?.trim() || '';
            const inputStr = cells[1].textContent?.trim() || '';
            // Cached column may or may not exist
            const cachedStr = hasCached && cells.length >= 4 ? cells[2].textContent?.trim() || '' : '';
            const outputStr = hasCached && cells.length >= 4 ? cells[3].textContent?.trim() || '' : cells[2].textContent?.trim() || '';

            const inputPrice = parsePrice(inputStr);
            const outputPrice = parsePrice(outputStr);
            const cachedPrice = cachedStr === '-' || !cachedStr ? undefined : parsePrice(cachedStr);

            if (!isNaN(inputPrice) && !isNaN(outputPrice) && modelName) {
              results.push({
                modelId: modelName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-\.]/g, ''),
                modelName: modelName,
                input: inputPrice,
                output: outputPrice,
                cached: cachedPrice,
              });
            }
          }

          // Only process the first matching table (Text tokens)
          // to avoid including image/audio models
          if (results.length > 0) break;
        }

        return results;
      });

      // Also get legacy models
      const legacyModels = await page.evaluate(() => {
        const results: {
          modelId: string;
          modelName: string;
          input: number;
          output: number;
        }[] = [];

        const parsePrice = (str: string): number => {
          const match = str.match(/\$([0-9.]+)/);
          return match ? parseFloat(match[1]) : NaN;
        };

        const headings = Array.from(document.querySelectorAll('h3'));
        const legacyHeading = headings.find(h =>
          h.textContent?.toLowerCase().includes('legacy models')
        );

        if (!legacyHeading) return results;

        let element: Element | null = legacyHeading;
        let table: HTMLTableElement | null = null;

        while (element && !table) {
          element = element.nextElementSibling;
          if (element?.tagName === 'TABLE') {
            table = element as HTMLTableElement;
          } else if (element) {
            table = element.querySelector('table');
          }
        }

        if (!table) return results;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            const modelName = cells[0].textContent?.trim() || '';
            const inputStr = cells[1].textContent?.trim() || '';
            const outputStr = cells[2].textContent?.trim() || '';

            const inputPrice = parsePrice(inputStr);
            const outputPrice = parsePrice(outputStr);

            if (!isNaN(inputPrice) && !isNaN(outputPrice) && modelName) {
              results.push({
                modelId: modelName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-\.]/g, ''),
                modelName: modelName,
                input: inputPrice,
                output: outputPrice,
              });
            }
          }
        }

        return results;
      });

      // Combine and convert to ModelPricing format
      const allModels: ModelPricing[] = [];
      const seenIds = new Set<string>();

      for (const m of models) {
        if (!seenIds.has(m.modelId) && this.isTextModel(m.modelName)) {
          seenIds.add(m.modelId);
          allModels.push({
            modelId: m.modelId,
            modelName: m.modelName,
            inputPricePerMillion: m.input,
            outputPricePerMillion: m.output,
            cachedInputPricePerMillion: m.cached,
          });
        }
      }

      for (const m of legacyModels) {
        if (!seenIds.has(m.modelId) && this.isTextModel(m.modelName)) {
          seenIds.add(m.modelId);
          allModels.push({
            modelId: m.modelId,
            modelName: m.modelName,
            inputPricePerMillion: m.input,
            outputPricePerMillion: m.output,
          });
        }
      }

      console.log(`[openai] Found ${allModels.length} text models`);

      if (allModels.length === 0) {
        throw new Error('[openai] Could not parse any pricing from page');
      }

      if (allModels.length < 5) {
        throw new Error(`[openai] Only found ${allModels.length} models, expected at least 5`);
      }

      return allModels;
    } finally {
      await browser.close();
    }
  }

  private isTextModel(name: string): boolean {
    const n = name.toLowerCase();
    // Exclude non-text models
    const isExcluded = [
      'audio',
      'tts',
      'transcribe',
      'realtime',
      'image',
      'dall',
      'whisper',
      'embedding',
      'sora',
    ].some(x => n.includes(x));
    return !isExcluded;
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
