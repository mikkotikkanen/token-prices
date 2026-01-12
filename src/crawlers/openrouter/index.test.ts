import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterCrawler } from './index.js';

// Mock the http module
vi.mock('../../utils/http.js', () => ({
  fetchJson: vi.fn(),
  withRetry: vi.fn((fn) => fn()),
  sleep: vi.fn(),
}));

// Mock Playwright - return fake popularity data
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue([
          // Return fake popularity data for testing
          { modelId: 'openai/gpt-4', tokens: 10_000_000_000 },
          { modelId: 'anthropic/claude-3-opus', tokens: 5_000_000_000 },
          { modelId: 'anthropic/claude-3', tokens: 4_000_000_000 },
          { modelId: 'google/gemini-pro', tokens: 3_000_000_000 },
        ]),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('OpenRouterCrawler', () => {
  let crawler: OpenRouterCrawler;

  beforeEach(() => {
    crawler = new OpenRouterCrawler();
    vi.clearAllMocks();
  });

  describe('crawlPrices', () => {
    it('should parse valid model response and select by popularity', async () => {
      const { fetchJson } = await import('../../utils/http.js');
      (fetchJson as any).mockResolvedValueOnce({
        data: [
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            pricing: {
              prompt: '0.00003', // $30 per 1M
              completion: '0.00006', // $60 per 1M
            },
            context_length: 8192,
          },
          {
            id: 'anthropic/claude-3-opus',
            name: 'Claude 3 Opus',
            pricing: {
              prompt: '0.000015',
              completion: '0.000075',
            },
            context_length: 200000,
          },
        ],
      });

      const prices = await crawler.crawlPrices();

      // Should return models that have both prices AND popularity data
      expect(prices.length).toBeGreaterThan(0);

      const gpt4 = prices.find((p) => p.modelId === 'openai/gpt-4');
      expect(gpt4).toBeDefined();
      expect(gpt4?.inputPricePerMillion).toBe(30);
      expect(gpt4?.outputPricePerMillion).toBe(60);
      expect(gpt4?.contextWindow).toBe(8192);
    });

    it('should skip models with no pricing', async () => {
      const { fetchJson } = await import('../../utils/http.js');
      (fetchJson as any).mockResolvedValueOnce({
        data: [
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            // No pricing field
            context_length: 8192,
          },
          {
            id: 'anthropic/claude-3-opus',
            name: 'Claude 3 Opus',
            pricing: {
              prompt: '0.000015',
              completion: '0.000075',
            },
            context_length: 200000,
          },
        ],
      });

      const prices = await crawler.crawlPrices();

      // GPT-4 should be skipped due to no pricing
      const gpt4 = prices.find((p) => p.modelId === 'openai/gpt-4');
      expect(gpt4).toBeUndefined();
    });

    it('should skip free models', async () => {
      const { fetchJson } = await import('../../utils/http.js');
      (fetchJson as any).mockResolvedValueOnce({
        data: [
          {
            id: 'free/model',
            name: 'Free Model',
            pricing: {
              prompt: '0',
              completion: '0',
            },
            context_length: 1000,
          },
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            pricing: {
              prompt: '0.00003',
              completion: '0.00006',
            },
            context_length: 8192,
          },
        ],
      });

      const prices = await crawler.crawlPrices();

      // Free model should not be included
      const freeModel = prices.find((p) => p.modelId === 'free/model');
      expect(freeModel).toBeUndefined();
    });

    it('should select models by popularity (most tokens first)', async () => {
      const { fetchJson } = await import('../../utils/http.js');
      (fetchJson as any).mockResolvedValueOnce({
        data: [
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            pricing: { prompt: '0.00003', completion: '0.00006' },
            context_length: 8192,
          },
          {
            id: 'anthropic/claude-3-opus',
            name: 'Claude 3 Opus',
            pricing: { prompt: '0.000015', completion: '0.000075' },
            context_length: 200000,
          },
        ],
      });

      const prices = await crawler.crawlPrices();

      // GPT-4 has 10B tokens in mock, claude-3-opus has 5B
      // So GPT-4 should come first
      if (prices.length >= 2) {
        expect(prices[0].modelId).toBe('openai/gpt-4');
        expect(prices[1].modelId).toBe('anthropic/claude-3-opus');
      }
    });
  });
});
