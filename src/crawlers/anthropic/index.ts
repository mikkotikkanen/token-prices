import { chromium } from 'playwright';
import { BaseCrawler } from '../base.js';
import { ModelPricing, Provider } from '../../types.js';

/**
 * Anthropic price crawler
 * Uses Playwright to scrape prices from Anthropic's platform pricing page
 */
export class AnthropicCrawler extends BaseCrawler {
  readonly provider: Provider = 'anthropic';
  readonly pricingUrl = 'https://platform.claude.com/docs/en/about-claude/pricing';

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
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for the pricing table to load
      await page.waitForSelector('table', { timeout: 10000 });

      // Extract pricing data from the "Model pricing" section
      // Table columns: Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens
      const models = await page.evaluate(() => {
        const results: {
          modelId: string;
          modelName: string;
          input: number;
          output: number;
          cached?: number;
        }[] = [];

        // Helper to parse price string like "$5 / MTok" to number
        const parsePrice = (str: string): number => {
          const match = str.match(/\$([0-9.]+)/);
          return match ? parseFloat(match[1]) : NaN;
        };

        // Find the "Model pricing" heading
        const headings = Array.from(document.querySelectorAll('h2'));
        const modelPricingHeading = headings.find(h =>
          h.textContent?.toLowerCase().includes('model pricing')
        );

        if (!modelPricingHeading) {
          console.error('Could not find "Model pricing" heading');
          return results;
        }

        // Find the next table element after this heading
        let element: Element | null = modelPricingHeading;
        let table: HTMLTableElement | null = null;

        while (element && !table) {
          element = element.nextElementSibling;
          if (element?.tagName === 'TABLE') {
            table = element as HTMLTableElement;
          } else if (element) {
            table = element.querySelector('table');
          }
        }

        if (!table) {
          console.error('Could not find pricing table after Model pricing heading');
          return results;
        }

        // Parse the table rows
        // Columns: Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 6) {
            const modelName = cells[0].textContent?.trim() || '';
            const inputStr = cells[1].textContent?.trim() || '';  // Base Input Tokens
            const cacheHitsStr = cells[4].textContent?.trim() || '';  // Cache Hits & Refreshes
            const outputStr = cells[5].textContent?.trim() || '';  // Output Tokens

            // Skip header rows or non-Claude models
            if (!modelName.toLowerCase().includes('claude')) {
              continue;
            }

            const inputPrice = parsePrice(inputStr);
            const outputPrice = parsePrice(outputStr);
            const cachedPrice = parsePrice(cacheHitsStr);

            if (!isNaN(inputPrice) && !isNaN(outputPrice) && modelName) {
              results.push({
                modelId: modelName
                  .toLowerCase()
                  .replace(/\s+/g, '-')
                  .replace(/[^a-z0-9\-\.]/g, '')
                  .replace(/\(deprecated\)/g, ''),
                modelName: modelName.replace(/\s*\(deprecated\)\s*/g, ''),
                input: inputPrice,
                output: outputPrice,
                cached: !isNaN(cachedPrice) ? cachedPrice : undefined,
              });
            }
          }
        }

        return results;
      });

      // Convert to ModelPricing format and dedupe
      const allModels: ModelPricing[] = [];
      const seenIds = new Set<string>();

      for (const m of models) {
        // Clean up model ID
        const modelId = m.modelId.replace(/--+/g, '-').replace(/-$/, '');

        if (!seenIds.has(modelId) && this.isTextModel(m.modelName)) {
          seenIds.add(modelId);
          allModels.push({
            modelId: modelId,
            modelName: m.modelName,
            inputPricePerMillion: m.input,
            outputPricePerMillion: m.output,
            cachedInputPricePerMillion: m.cached,
          });
        }
      }

      console.log(`[anthropic] Found ${allModels.length} text models`);

      if (allModels.length === 0) {
        throw new Error('[anthropic] Could not parse any pricing from page');
      }

      if (allModels.length < 3) {
        throw new Error(`[anthropic] Only found ${allModels.length} models, expected at least 3`);
      }

      return allModels;
    } finally {
      await browser.close();
    }
  }

  private isTextModel(name: string): boolean {
    const n = name.toLowerCase();
    // Exclude non-text models
    const isExcluded = ['tts', 'embedding', 'image'].some(x => n.includes(x));
    return !isExcluded;
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
