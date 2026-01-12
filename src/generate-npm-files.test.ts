import { describe, it, expect, vi, beforeEach } from 'vitest';
import { historyToProviderData } from './generate-npm-files.js';
import type { ProviderPriceHistory, ModelPricing as InternalModelPricing } from './types.js';

// Mock storage module
vi.mock('./utils/storage.js', () => ({
  getCurrentSnapshot: vi.fn((history: ProviderPriceHistory) => ({
    provider: history.provider,
    date: history.lastCrawled.split('T')[0],
    models: history.changes
      .filter(c => c.changeType !== 'removed')
      .map(c => c.pricing),
  })),
}));

describe('generate-npm-files', () => {
  describe('historyToProviderData', () => {
    it('should convert internal ModelPricing to public format', () => {
      const history: ProviderPriceHistory = {
        provider: 'openai',
        lastCrawled: '2024-01-15T00:01:00Z',
        pricingUrl: 'https://openai.com/api/pricing/',
        changes: [
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'gpt-4o',
              modelName: 'GPT-4o',
              inputPricePerMillion: 2.5,
              outputPricePerMillion: 10,
              contextWindow: 128000,
              maxOutputTokens: 16384,
            },
          },
        ],
      };

      const result = historyToProviderData(history);

      expect(result.date).toBe('2024-01-15');
      expect(result.models['gpt-4o']).toEqual({
        input: 2.5,
        output: 10,
        context: 128000,
        maxOutput: 16384,
      });
    });

    it('should map all pricing fields correctly', () => {
      const history: ProviderPriceHistory = {
        provider: 'anthropic',
        lastCrawled: '2024-01-15T00:01:00Z',
        pricingUrl: 'https://anthropic.com/pricing',
        changes: [
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'claude-3.5-sonnet',
              modelName: 'Claude 3.5 Sonnet',
              inputPricePerMillion: 3,
              outputPricePerMillion: 15,
              cachedInputPricePerMillion: 0.3,
              contextWindow: 200000,
              maxOutputTokens: 8192,
            },
          },
        ],
      };

      const result = historyToProviderData(history);
      const model = result.models['claude-3.5-sonnet'];

      expect(model.input).toBe(3);
      expect(model.output).toBe(15);
      expect(model.cached).toBe(0.3);
      expect(model.context).toBe(200000);
      expect(model.maxOutput).toBe(8192);
    });

    it('should omit undefined optional fields', () => {
      const history: ProviderPriceHistory = {
        provider: 'openai',
        lastCrawled: '2024-01-15T00:01:00Z',
        pricingUrl: 'https://openai.com/api/pricing/',
        changes: [
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'gpt-4',
              modelName: 'GPT-4',
              inputPricePerMillion: 30,
              outputPricePerMillion: 60,
              // No contextWindow, maxOutputTokens, or cachedInputPricePerMillion
            },
          },
        ],
      };

      const result = historyToProviderData(history);
      const model = result.models['gpt-4'];

      expect(model.input).toBe(30);
      expect(model.output).toBe(60);
      expect(model).not.toHaveProperty('cached');
      expect(model).not.toHaveProperty('context');
      expect(model).not.toHaveProperty('maxOutput');
    });

    it('should handle multiple models', () => {
      const history: ProviderPriceHistory = {
        provider: 'google',
        lastCrawled: '2024-01-15T00:01:00Z',
        pricingUrl: 'https://ai.google.dev/pricing',
        changes: [
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'gemini-1.5-pro',
              modelName: 'Gemini 1.5 Pro',
              inputPricePerMillion: 1.25,
              outputPricePerMillion: 5,
            },
          },
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'gemini-1.5-flash',
              modelName: 'Gemini 1.5 Flash',
              inputPricePerMillion: 0.075,
              outputPricePerMillion: 0.3,
            },
          },
        ],
      };

      const result = historyToProviderData(history);

      expect(Object.keys(result.models)).toHaveLength(2);
      expect(result.models['gemini-1.5-pro'].input).toBe(1.25);
      expect(result.models['gemini-1.5-flash'].input).toBe(0.075);
    });

    it('should extract date from ISO timestamp', () => {
      const history: ProviderPriceHistory = {
        provider: 'openai',
        lastCrawled: '2024-03-20T12:30:45.123Z',
        pricingUrl: 'https://openai.com/api/pricing/',
        changes: [],
      };

      const result = historyToProviderData(history);

      expect(result.date).toBe('2024-03-20');
    });

    it('should handle zero prices correctly', () => {
      const history: ProviderPriceHistory = {
        provider: 'openrouter',
        lastCrawled: '2024-01-15T00:01:00Z',
        pricingUrl: 'https://openrouter.ai/models',
        changes: [
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'some-free-model',
              modelName: 'Free Model',
              inputPricePerMillion: 0,
              outputPricePerMillion: 0,
            },
          },
        ],
      };

      const result = historyToProviderData(history);

      expect(result.models['some-free-model'].input).toBe(0);
      expect(result.models['some-free-model'].output).toBe(0);
    });

    it('should handle decimal precision', () => {
      const history: ProviderPriceHistory = {
        provider: 'google',
        lastCrawled: '2024-01-15T00:01:00Z',
        pricingUrl: 'https://ai.google.dev/pricing',
        changes: [
          {
            date: '2024-01-15',
            changeType: 'added',
            pricing: {
              modelId: 'gemini-1.5-flash-8b',
              modelName: 'Gemini 1.5 Flash-8B',
              inputPricePerMillion: 0.0375,
              outputPricePerMillion: 0.15,
            },
          },
        ],
      };

      const result = historyToProviderData(history);

      expect(result.models['gemini-1.5-flash-8b'].input).toBe(0.0375);
      expect(result.models['gemini-1.5-flash-8b'].output).toBe(0.15);
    });
  });
});
