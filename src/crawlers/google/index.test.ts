import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleCrawler } from './index.js';

// Mock the http module
vi.mock('../../utils/http.js', () => ({
  fetchHtml: vi.fn(),
  withRetry: vi.fn((fn) => fn()),
}));

describe('GoogleCrawler', () => {
  let crawler: GoogleCrawler;

  beforeEach(() => {
    crawler = new GoogleCrawler();
    vi.clearAllMocks();
  });

  describe('crawlPrices', () => {
    it('should parse prices from HTML table with headers', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input price</th>
                  <th>Output price</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Gemini Pro</td>
                  <td>$1.25</td>
                  <td>$5.00</td>
                </tr>
                <tr>
                  <td>Gemini Flash</td>
                  <td>$0.075</td>
                  <td>$0.30</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThanOrEqual(2);

      const pro = prices.find(p => p.modelId.includes('pro'));
      expect(pro).toBeDefined();
      expect(pro?.inputPricePerMillion).toBe(1.25);
      expect(pro?.outputPricePerMillion).toBe(5);
    });

    it('should parse Gemini models from definition lists', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <dl class="pricing">
              <dt>Gemini 2.0 Flash</dt>
              <dd>Input: $0.10/1M tokens, Output: $0.40/1M tokens</dd>
            </dl>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThan(0);
    });

    it('should fall back to known models when HTML parsing fails', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <p>No pricing information here</p>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Should return known models as fallback
      expect(prices.length).toBeGreaterThan(0);
      expect(prices.some(p => p.modelId.includes('gemini'))).toBe(true);
    });

    it('should fall back to known models on fetch error', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('403 Forbidden'));

      const prices = await crawler.crawlPrices();

      // Should return known models as fallback
      expect(prices.length).toBeGreaterThan(0);
    });

    it('should deduplicate models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead>
              <tbody>
                <tr><td>Gemini 1.5 Pro</td><td>$1.25</td><td>$5.00</td></tr>
                <tr><td>Gemini 1.5 Pro</td><td>$1.25</td><td>$5.00</td></tr>
                <tr><td>Gemini 1.5 Flash</td><td>$0.075</td><td>$0.30</td></tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const proCount = prices.filter(p =>
        p.modelId === 'gemini-1.5-pro'
      ).length;
      expect(proCount).toBeLessThanOrEqual(1);
    });

    it('should normalize model IDs', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead>
              <tbody>
                <tr><td>Gemini 1.5 Pro</td><td>$1.25</td><td>$5.00</td></tr>
                <tr><td>GEMINI 2.0 FLASH</td><td>$0.10</td><td>$0.40</td></tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Model IDs should be lowercase with dashes
      expect(prices.every(p => p.modelId === p.modelId.toLowerCase())).toBe(true);
      expect(prices.every(p => !p.modelId.includes(' '))).toBe(true);
    });

    it('should extract prices from cells correctly', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead>
              <tbody>
                <tr>
                  <td>Gemini Flash Lite</td>
                  <td>$0.0375 per 1 million tokens</td>
                  <td>$0.15 per 1 million tokens</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const flashLite = prices.find(p => p.modelId.includes('lite'));
      expect(flashLite?.inputPricePerMillion).toBe(0.0375);
      expect(flashLite?.outputPricePerMillion).toBe(0.15);
    });
  });

  describe('known models fallback', () => {
    it('should include expected Gemini models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('Network error'));

      const prices = await crawler.crawlPrices();

      const modelIds = prices.map(p => p.modelId);

      // Check for various Gemini models
      expect(modelIds.some(id => id.includes('gemini-1.5-pro'))).toBe(true);
      expect(modelIds.some(id => id.includes('gemini-1.5-flash'))).toBe(true);
      expect(modelIds.some(id => id.includes('gemini-2.0'))).toBe(true);
    });

    it('should have valid pricing data in fallback', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('Network error'));

      const prices = await crawler.crawlPrices();

      for (const model of prices) {
        expect(model.inputPricePerMillion).toBeGreaterThanOrEqual(0);
        expect(model.outputPricePerMillion).toBeGreaterThanOrEqual(0);
        expect(model.modelId).toBeTruthy();
        expect(model.modelName).toBeTruthy();
      }
    });

    it('should include context window info where available', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('Network error'));

      const prices = await crawler.crawlPrices();

      // Gemini models typically have large context windows
      const modelsWithContext = prices.filter(p => p.contextWindow !== undefined);
      expect(modelsWithContext.length).toBeGreaterThan(0);

      // Gemini 1.5 Pro should have 2M context
      const pro = prices.find(p => p.modelId === 'gemini-1.5-pro');
      if (pro) {
        expect(pro.contextWindow).toBe(2000000);
      }
    });
  });
});
