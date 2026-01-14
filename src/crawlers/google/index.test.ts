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
    it('should parse prices from code elements with pricing tables', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      // Simulate the actual Google AI pricing page format
      // The crawler looks for <code>gemini-*</code> elements then finds pricing tables
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <h2>Gemini 2.5 Pro</h2>
            <code>gemini-2.5-pro</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$1.25</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$10.00</td></tr>
              <tr><td>Context caching price</td><td>Free</td><td>$0.125</td></tr>
            </table>
            <h2>Gemini 2.5 Flash</h2>
            <code>gemini-2.5-flash</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.30</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$2.50</td></tr>
              <tr><td>Context caching price</td><td>Free</td><td>$0.03</td></tr>
            </table>
            <h2>Gemini 2.0 Flash</h2>
            <code>gemini-2.0-flash</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.10</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$0.40</td></tr>
              <tr><td>Context caching price</td><td>Free</td><td>$0.025</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThanOrEqual(3);

      const pro = prices.find(p => p.modelId === 'gemini-2.5-pro');
      expect(pro).toBeDefined();
      expect(pro?.inputPricePerMillion).toBe(1.25);
      expect(pro?.outputPricePerMillion).toBe(10);
      expect(pro?.cachedInputPricePerMillion).toBe(0.125);
    });

    it('should include cached input pricing', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <h2>Gemini 2.5 Pro</h2>
            <code>gemini-2.5-pro</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$1.25</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$10.00</td></tr>
              <tr><td>Context caching price</td><td>Free</td><td>$0.125</td></tr>
            </table>
            <h2>Gemini 2.5 Flash</h2>
            <code>gemini-2.5-flash</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.30</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$2.50</td></tr>
              <tr><td>Context caching price</td><td>Free</td><td>$0.03</td></tr>
            </table>
            <h2>Gemini 2.0 Flash</h2>
            <code>gemini-2.0-flash</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.10</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$0.40</td></tr>
              <tr><td>Context caching price</td><td>Free</td><td>$0.025</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const pro = prices.find(p => p.modelId === 'gemini-2.5-pro');
      expect(pro?.cachedInputPricePerMillion).toBe(0.125);
    });

    it('should filter out non-text models', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <h2>Gemini 2.5 Pro</h2>
            <code>gemini-2.5-pro</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$1.25</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$10.00</td></tr>
            </table>
            <h2>Gemini 2.5 Flash</h2>
            <code>gemini-2.5-flash</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.30</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$2.50</td></tr>
            </table>
            <h2>Gemini 2.0 Flash</h2>
            <code>gemini-2.0-flash</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.10</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$0.40</td></tr>
            </table>
            <h2>Gemini TTS</h2>
            <code>gemini-tts-model</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.50</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$1.00</td></tr>
            </table>
            <h2>Gemini Embedding</h2>
            <code>gemini-embedding-model</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$0.10</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$0.10</td></tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Should filter out TTS and embedding models
      expect(prices.some(p => p.modelId.includes('tts'))).toBe(false);
      expect(prices.some(p => p.modelId.includes('embedding'))).toBe(false);
    });

    it('should throw error when HTML parsing fails', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <p>No pricing information here</p>
          </body>
        </html>
      `);

      await expect(crawler.crawlPrices()).rejects.toThrow('[google] Could not parse any pricing from HTML');
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
            <h2>Gemini 2.5 Pro</h2>
            <code>gemini-2.5-pro</code>
            <table>
              <tr><td>Input price</td><td>Free</td><td>$1.25</td></tr>
              <tr><td>Output price</td><td>Free</td><td>$10.00</td></tr>
            </table>
          </body>
        </html>
      `);

      await expect(crawler.crawlPrices()).rejects.toThrow('expected at least 3');
    });
  });
});
