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
    it('should parse prices from platform.claude.com pricing table', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      // Simulate the actual Anthropic pricing page format
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr>
                <td>Model</td>
                <td>Base Input Tokens</td>
                <td>5m Cache Writes</td>
                <td>1h Cache Writes</td>
                <td>Cache Hits & Refreshes</td>
                <td>Output Tokens</td>
              </tr>
              <tr>
                <td>Claude Opus 4.5</td>
                <td>$5 / MTok</td>
                <td>$6.25 / MTok</td>
                <td>$10 / MTok</td>
                <td>$0.50 / MTok</td>
                <td>$25 / MTok</td>
              </tr>
              <tr>
                <td>Claude Opus 4.1</td>
                <td>$15 / MTok</td>
                <td>$18.75 / MTok</td>
                <td>$30 / MTok</td>
                <td>$1.50 / MTok</td>
                <td>$75 / MTok</td>
              </tr>
              <tr>
                <td>Claude Opus 4</td>
                <td>$15 / MTok</td>
                <td>$18.75 / MTok</td>
                <td>$30 / MTok</td>
                <td>$1.50 / MTok</td>
                <td>$75 / MTok</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      expect(prices.length).toBeGreaterThanOrEqual(3);

      const opus45 = prices.find(p => p.modelId === 'claude-opus-4.5');
      expect(opus45).toBeDefined();
      expect(opus45?.inputPricePerMillion).toBe(5);
      expect(opus45?.outputPricePerMillion).toBe(25);
      expect(opus45?.cachedInputPricePerMillion).toBe(0.5);
    });

    it('should include cached input pricing from Cache Hits column', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr>
                <td>Claude Opus 4.5</td>
                <td>$5 / MTok</td>
                <td>$6.25 / MTok</td>
                <td>$10 / MTok</td>
                <td>$0.50 / MTok</td>
                <td>$25 / MTok</td>
              </tr>
              <tr>
                <td>Claude Opus 4.1</td>
                <td>$15 / MTok</td>
                <td>$18.75 / MTok</td>
                <td>$30 / MTok</td>
                <td>$1.50 / MTok</td>
                <td>$75 / MTok</td>
              </tr>
              <tr>
                <td>Claude Sonnet 4</td>
                <td>$3 / MTok</td>
                <td>$3.75 / MTok</td>
                <td>$6 / MTok</td>
                <td>$0.30 / MTok</td>
                <td>$15 / MTok</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      const opus45 = prices.find(p => p.modelId === 'claude-opus-4.5');
      expect(opus45?.cachedInputPricePerMillion).toBe(0.5);

      const opus41 = prices.find(p => p.modelId === 'claude-opus-4.1');
      expect(opus41?.cachedInputPricePerMillion).toBe(1.5);
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

      await expect(crawler.crawlPrices()).rejects.toThrow('[anthropic] Could not parse any pricing from HTML');
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
              <tr>
                <td>Claude Opus 4.5</td>
                <td>$5 / MTok</td>
                <td>$6.25 / MTok</td>
                <td>$10 / MTok</td>
                <td>$0.50 / MTok</td>
                <td>$25 / MTok</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      await expect(crawler.crawlPrices()).rejects.toThrow('expected at least 3');
    });

    it('should normalize model IDs', async () => {
      const { fetchHtml } = await import('../../utils/http.js');
      (fetchHtml as any).mockResolvedValueOnce(`
        <html>
          <body>
            <table>
              <tr>
                <td>Claude Opus 4.5</td>
                <td>$5 / MTok</td>
                <td>$6.25 / MTok</td>
                <td>$10 / MTok</td>
                <td>$0.50 / MTok</td>
                <td>$25 / MTok</td>
              </tr>
              <tr>
                <td>Claude Opus 4.1</td>
                <td>$15 / MTok</td>
                <td>$18.75 / MTok</td>
                <td>$30 / MTok</td>
                <td>$1.50 / MTok</td>
                <td>$75 / MTok</td>
              </tr>
              <tr>
                <td>Claude Sonnet 4</td>
                <td>$3 / MTok</td>
                <td>$3.75 / MTok</td>
                <td>$6 / MTok</td>
                <td>$0.30 / MTok</td>
                <td>$15 / MTok</td>
              </tr>
            </table>
          </body>
        </html>
      `);

      const prices = await crawler.crawlPrices();

      // Model IDs should be lowercase with dashes
      expect(prices.every(p => p.modelId === p.modelId.toLowerCase())).toBe(true);
      expect(prices.every(p => !p.modelId.includes(' '))).toBe(true);
      expect(prices.some(p => p.modelId === 'claude-opus-4.5')).toBe(true);
    });
  });
});
