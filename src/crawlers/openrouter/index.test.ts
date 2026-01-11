import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterCrawler } from './index.js';

// Mock the http module
vi.mock('../../utils/http.js', () => ({
  fetchJson: vi.fn(),
  withRetry: vi.fn((fn) => fn()),
  sleep: vi.fn(),
}));

describe('OpenRouterCrawler', () => {
  let crawler: OpenRouterCrawler;

  beforeEach(() => {
    crawler = new OpenRouterCrawler();
    vi.clearAllMocks();
  });

  describe('parseApiResponse', () => {
    it('should parse valid model response', async () => {
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

      expect(prices).toHaveLength(2);

      const gpt4 = prices.find((p) => p.modelId === 'openai/gpt-4');
      expect(gpt4).toBeDefined();
      expect(gpt4?.inputPricePerMillion).toBe(30);
      expect(gpt4?.outputPricePerMillion).toBe(60);
      expect(gpt4?.contextWindow).toBe(8192);

      const claude = prices.find((p) => p.modelId === 'anthropic/claude-3-opus');
      expect(claude).toBeDefined();
      expect(claude?.inputPricePerMillion).toBe(15);
      expect(claude?.outputPricePerMillion).toBe(75);
    });

    it('should skip models with no pricing', async () => {
      const { fetchJson } = await import('../../utils/http.js');
      (fetchJson as any).mockResolvedValueOnce({
        data: [
          {
            id: 'some/model',
            name: 'Some Model',
            // No pricing
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

      expect(prices).toHaveLength(1);
      expect(prices[0].modelId).toBe('openai/gpt-4');
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

      expect(prices).toHaveLength(1);
      expect(prices[0].modelId).toBe('openai/gpt-4');
    });

    it('should prioritize popular models', async () => {
      const { fetchJson } = await import('../../utils/http.js');
      (fetchJson as any).mockResolvedValueOnce({
        data: [
          {
            id: 'some-unknown/model',
            name: 'Unknown Model',
            pricing: { prompt: '0.00001', completion: '0.00002' },
            context_length: 1000,
          },
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            pricing: { prompt: '0.00003', completion: '0.00006' },
            context_length: 8192,
          },
          {
            id: 'anthropic/claude-3',
            name: 'Claude 3',
            pricing: { prompt: '0.000015', completion: '0.000075' },
            context_length: 200000,
          },
        ],
      });

      const prices = await crawler.crawlPrices();

      // OpenAI should come first, then Anthropic, then unknown
      expect(prices[0].modelId).toBe('openai/gpt-4');
      expect(prices[1].modelId).toBe('anthropic/claude-3');
      expect(prices[2].modelId).toBe('some-unknown/model');
    });
  });
});
