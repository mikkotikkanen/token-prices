import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicCrawler } from './index.js';

// Mock the http module
vi.mock('../../utils/http.js', () => ({
  fetchHtml: vi.fn(),
  withRetry: vi.fn((fn) => fn()),
}));

describe('AnthropicCrawler', () => {
  let crawler: AnthropicCrawler;

  beforeEach(() => {
    crawler = new AnthropicCrawler();
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
                  <th>Input</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Claude 3.5 Sonnet</td>
                  <td>$3.00 / MTok</td>
                  <td>$15.00 / MTok</td>
                </tr>
                <tr>
                  <td>Claude 3 Opus</td>
                  <td>$15.00 / MTok</td>
                  <td>$75.00 / MTok</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThanOrEqual(2);

      const sonnet = prices.find(p => p.modelId.includes('sonnet'));
      expect(sonnet).toBeDefined();
      expect(sonnet?.inputPricePerMillion).toBe(3);
      expect(sonnet?.outputPricePerMillion).toBe(15);
    });

    it('should parse Claude models from pricing cards', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <div class="pricing-card">
              <h3>Claude 3 Haiku</h3>
              <p>Input: $0.25/M Output: $1.25/M</p>
            </div>
            <div class="model-card">
              <span>Claude Sonnet</span>
              <span>$3.00/MTok input, $15.00/MTok output</span>
            </div>
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
      expect(prices.some(p => p.modelId.includes('opus') || p.modelId.includes('sonnet'))).toBe(true);
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
                <tr><td>Claude 3 Opus</td><td>$15.00/M</td><td>$75.00/M</td></tr>
                <tr><td>Claude 3 Opus</td><td>$15.00/M</td><td>$75.00/M</td></tr>
                <tr><td>Claude 3 Sonnet</td><td>$3.00/M</td><td>$15.00/M</td></tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const opusCount = prices.filter(p => p.modelId.includes('opus')).length;
      expect(opusCount).toBeLessThanOrEqual(1);
    });

    it('should normalize model IDs', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead>
              <tbody>
                <tr><td>Claude 3.5 Sonnet</td><td>$3.00/M</td><td>$15.00/M</td></tr>
                <tr><td>Claude 3 OPUS</td><td>$15.00/M</td><td>$75.00/M</td></tr>
                <tr><td>claude-3-haiku</td><td>$0.25/M</td><td>$1.25/M</td></tr>
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

    it('should handle price scale detection', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead>
              <tbody>
                <tr><td>Claude 3.5 Sonnet</td><td>$3.00 per million</td><td>$15.00 per million</td></tr>
              </tbody>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const sonnet = prices.find(p => p.modelId.includes('sonnet'));
      expect(sonnet?.inputPricePerMillion).toBe(3);
      expect(sonnet?.outputPricePerMillion).toBe(15);
    });
  });

  describe('known models fallback', () => {
    it('should include expected Claude models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('Network error'));

      const prices = await crawler.crawlPrices();

      // Check for various Claude model generations
      const hasOpus = prices.some(p => p.modelId.includes('opus'));
      const hasSonnet = prices.some(p => p.modelId.includes('sonnet'));
      const hasHaiku = prices.some(p => p.modelId.includes('haiku'));

      expect(hasOpus).toBe(true);
      expect(hasSonnet).toBe(true);
      expect(hasHaiku).toBe(true);
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

    it('should include cached pricing where applicable', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('Network error'));

      const prices = await crawler.crawlPrices();

      // Some Claude models support cached input pricing
      const modelsWithCached = prices.filter(p => p.cachedInputPricePerMillion !== undefined);
      expect(modelsWithCached.length).toBeGreaterThan(0);
    });
  });
});
