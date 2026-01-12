import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICrawler } from './index.js';

// Mock the http module
vi.mock('../../utils/http.js', () => ({
  fetchHtml: vi.fn(),
  withRetry: vi.fn((fn) => fn()),
}));

describe('OpenAICrawler', () => {
  let crawler: OpenAICrawler;

  beforeEach(() => {
    crawler = new OpenAICrawler();
    vi.clearAllMocks();
  });

  describe('crawlPrices', () => {
    it('should parse prices from HTML table', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr>
                <td>gpt-4o</td>
                <td>$2.50 / 1M tokens</td>
                <td>$10.00 / 1M tokens</td>
              </tr>
              <tr>
                <td>gpt-4o-mini</td>
                <td>$0.15 / 1M tokens</td>
                <td>$0.60 / 1M tokens</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThanOrEqual(2);

      const gpt4o = prices.find(p => p.modelId === 'gpt-4o');
      expect(gpt4o).toBeDefined();
      expect(gpt4o?.inputPricePerMillion).toBe(2.5);
      expect(gpt4o?.outputPricePerMillion).toBe(10);
    });

    it('should convert per-1K prices to per-1M', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr>
                <td>gpt-4</td>
                <td>$0.03</td>
                <td>$0.06</td>
              </tr>
              <tr>
                <td>gpt-3.5-turbo</td>
                <td>$0.0005</td>
                <td>$0.0015</td>
              </tr>
              <tr>
                <td>davinci-002</td>
                <td>$0.002</td>
                <td>$0.002</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const gpt4 = prices.find(p => p.modelId === 'gpt-4');
      expect(gpt4).toBeDefined();
      // $0.03/1K = $30/1M
      expect(gpt4?.inputPricePerMillion).toBe(30);
      expect(gpt4?.outputPricePerMillion).toBe(60);
    });

    it('should filter out invalid model names', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr>
                <td>gpt-4o</td>
                <td>$2.50 / 1M</td>
                <td>$10.00 / 1M</td>
              </tr>
              <tr>
                <td>Some random text that is not a model</td>
                <td>$1.00</td>
                <td>$2.00</td>
              </tr>
              <tr>
                <td>gpt-3.5-turbo</td>
                <td>$0.50 / 1M</td>
                <td>$1.50 / 1M</td>
              </tr>
              <tr>
                <td>o1-mini</td>
                <td>$3.00 / 1M</td>
                <td>$12.00 / 1M</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Should only include valid model names
      expect(prices.every(p =>
        p.modelId.startsWith('gpt-') ||
        p.modelId.startsWith('o1') ||
        p.modelId.startsWith('o3') ||
        p.modelId.startsWith('davinci') ||
        p.modelId.startsWith('text-')
      )).toBe(true);
    });

    it('should fall back to known models when HTML parsing fails', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <p>No pricing table here</p>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Should return known models as fallback
      expect(prices.length).toBeGreaterThan(0);
      expect(prices.some(p => p.modelId === 'gpt-4o')).toBe(true);
      expect(prices.some(p => p.modelId === 'gpt-4o-mini')).toBe(true);
    });

    it('should fall back to known models on fetch error', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('403 Forbidden'));

      const prices = await crawler.crawlPrices();

      // Should return known models as fallback
      expect(prices.length).toBeGreaterThan(0);
      expect(prices.some(p => p.modelId === 'gpt-4o')).toBe(true);
    });

    it('should deduplicate models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>gpt-4o</td><td>$2.50 / 1M</td><td>$10.00 / 1M</td></tr>
              <tr><td>gpt-4o</td><td>$2.50 / 1M</td><td>$10.00 / 1M</td></tr>
              <tr><td>gpt-4o-mini</td><td>$0.15 / 1M</td><td>$0.60 / 1M</td></tr>
              <tr><td>o1</td><td>$15.00 / 1M</td><td>$60.00 / 1M</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const gpt4oCount = prices.filter(p => p.modelId === 'gpt-4o').length;
      expect(gpt4oCount).toBe(1);
    });

    it('should normalize model IDs', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>GPT-4o</td><td>$2.50 / 1M</td><td>$10.00 / 1M</td></tr>
              <tr><td>GPT 4o Mini</td><td>$0.15 / 1M</td><td>$0.60 / 1M</td></tr>
              <tr><td>o1-preview</td><td>$15.00 / 1M</td><td>$60.00 / 1M</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Model IDs should be lowercase with dashes
      expect(prices.every(p => p.modelId === p.modelId.toLowerCase())).toBe(true);
      expect(prices.every(p => !p.modelId.includes(' '))).toBe(true);
    });
  });

  describe('known models fallback', () => {
    it('should include expected OpenAI models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('Network error'));

      const prices = await crawler.crawlPrices();

      const modelIds = prices.map(p => p.modelId);
      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4o-mini');
      expect(modelIds).toContain('gpt-4');
      expect(modelIds).toContain('gpt-3.5-turbo');
      expect(modelIds).toContain('o1');
      expect(modelIds).toContain('o1-mini');
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
  });
});
