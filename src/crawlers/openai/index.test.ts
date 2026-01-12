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
    it('should parse prices from standard section HTML table', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      // Simulate the actual OpenAI pricing page format with standard section
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>gpt-5.2</td><td>$1.75</td><td>$0.175</td><td>$14.00</td></tr>
              <tr><td>gpt-5.1</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5-mini</td><td>$0.25</td><td>$0.025</td><td>$2.00</td></tr>
              <tr><td>gpt-5-nano</td><td>$0.05</td><td>$0.005</td><td>$0.40</td></tr>
              <tr><td>gpt-4o</td><td>$2.50</td><td>$1.25</td><td>$10.00</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThanOrEqual(5);

      const gpt52 = prices.find(p => p.modelId === 'gpt-5.2');
      expect(gpt52).toBeDefined();
      expect(gpt52?.inputPricePerMillion).toBe(1.75);
      expect(gpt52?.outputPricePerMillion).toBe(14);
      expect(gpt52?.cachedInputPricePerMillion).toBe(0.175);
    });

    it('should include cached input pricing', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>gpt-5.2</td><td>$1.75</td><td>$0.175</td><td>$14.00</td></tr>
              <tr><td>gpt-5.1</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5-mini</td><td>$0.25</td><td>$0.025</td><td>$2.00</td></tr>
              <tr><td>gpt-5-nano</td><td>$0.05</td><td>$0.005</td><td>$0.40</td></tr>
              <tr><td>gpt-4o</td><td>$2.50</td><td>$1.25</td><td>$10.00</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const gpt52 = prices.find(p => p.modelId === 'gpt-5.2');
      expect(gpt52?.cachedInputPricePerMillion).toBe(0.175);
    });

    it('should filter out non-text models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>gpt-5.2</td><td>$1.75</td><td>$0.175</td><td>$14.00</td></tr>
              <tr><td>gpt-5.1</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5-mini</td><td>$0.25</td><td>$0.025</td><td>$2.00</td></tr>
              <tr><td>gpt-5-nano</td><td>$0.05</td><td>$0.005</td><td>$0.40</td></tr>
              <tr><td>gpt-4o-audio</td><td>$1.00</td><td>$0.50</td><td>$4.00</td></tr>
              <tr><td>gpt-image-model</td><td>$1.00</td><td>$0.50</td><td>$4.00</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Should filter out audio and image models
      expect(prices.some(p => p.modelId.includes('audio'))).toBe(false);
      expect(prices.some(p => p.modelId.includes('image'))).toBe(false);
    });

    it('should throw error when HTML parsing fails', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <p>No pricing table here</p>
          </body>
        </html>
      `);

      await expect(crawler.crawlPrices()).rejects.toThrow('[openai] Could not parse any pricing from HTML');
    });

    it('should throw error on fetch error', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockRejectedValueOnce(new Error('403 Forbidden'));

      await expect(crawler.crawlPrices()).rejects.toThrow('403 Forbidden');
    });

    it('should throw error when too few models found', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>gpt-5.2</td><td>$1.75</td><td>$0.175</td><td>$14.00</td></tr>
              <tr><td>gpt-5.1</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
            </table>
          </body>
        </html>
      `);

      await expect(crawler.crawlPrices()).rejects.toThrow('expected at least 5');
    });

    it('should normalize model IDs', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr><td>gpt-5.2</td><td>$1.75</td><td>$0.175</td><td>$14.00</td></tr>
              <tr><td>GPT-5.1</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>GPT 5</td><td>$1.25</td><td>$0.125</td><td>$10.00</td></tr>
              <tr><td>gpt-5-mini</td><td>$0.25</td><td>$0.025</td><td>$2.00</td></tr>
              <tr><td>gpt-5-nano</td><td>$0.05</td><td>$0.005</td><td>$0.40</td></tr>
              <tr><td>gpt-4o</td><td>$2.50</td><td>$1.25</td><td>$10.00</td></tr>
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
});
