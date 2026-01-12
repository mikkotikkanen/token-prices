import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PricingClient, ClockMismatchError } from './client.js';
import type { ProviderFile } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'npm');

// Helper to create a mock fetch that serves local files
function createLocalFetch(dataDir: string) {
  return async (url: string): Promise<Response> => {
    const urlObj = new URL(url);
    const filename = path.basename(urlObj.pathname);
    const filePath = path.join(dataDir, filename);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
}

// Helper to get current UTC date
function getUtcDate(offsetMs: number = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().split('T')[0];
}

describe('PricingClient', () => {
  let client: PricingClient;
  let openaiData: ProviderFile;
  let anthropicData: ProviderFile;

  beforeEach(async () => {
    // Load the actual data files for reference
    openaiData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'openai.json'), 'utf-8'));
    anthropicData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'anthropic.json'), 'utf-8'));

    // Create client with mock fetch pointing to local files
    client = new PricingClient({
      baseUrl: 'file://local',
      fetch: createLocalFetch(DATA_DIR),
      // Use timeOffset to match the data date so stale=false
      timeOffsetMs: (() => {
        const dataDate = new Date(openaiData.current.date + 'T00:00:00Z').getTime();
        const now = Date.now();
        return dataDate - now + 12 * 60 * 60 * 1000; // Set to noon on data date
      })(),
    });
  });

  describe('getModelPricing', () => {
    it('should return correct pricing for OpenAI gpt-4o', async () => {
      const result = await client.getModelPricing('openai', 'gpt-4o');

      expect(result.provider).toBe('openai');
      expect(result.modelId).toBe('gpt-4o');
      expect(result.pricing.input).toBe(2.5);
      expect(result.pricing.output).toBe(10);
      expect(result.pricing.context).toBe(128000);
      expect(result.date).toBe(openaiData.current.date);
      expect(result.stale).toBe(false);
    });

    it('should return correct pricing for OpenAI gpt-4o-mini', async () => {
      const result = await client.getModelPricing('openai', 'gpt-4o-mini');

      expect(result.pricing.input).toBe(0.15);
      expect(result.pricing.output).toBe(0.6);
      expect(result.pricing.context).toBe(128000);
    });

    it('should return correct pricing for OpenAI o1-pro (most expensive)', async () => {
      const result = await client.getModelPricing('openai', 'o1-pro');

      expect(result.pricing.input).toBe(150);
      expect(result.pricing.output).toBe(600);
      expect(result.pricing.context).toBe(200000);
    });

    it('should return correct pricing for Anthropic claude-sonnet-4', async () => {
      const result = await client.getModelPricing('anthropic', 'claude-sonnet-4');

      expect(result.provider).toBe('anthropic');
      expect(result.pricing.input).toBe(3);
      expect(result.pricing.output).toBe(15);
      expect(result.pricing.context).toBe(200000);
    });

    it('should return cached pricing for Anthropic claude-3.5-sonnet', async () => {
      const result = await client.getModelPricing('anthropic', 'claude-3.5-sonnet');

      expect(result.pricing.input).toBe(3);
      expect(result.pricing.output).toBe(15);
      expect(result.pricing.cached).toBe(0.3);
      expect(result.pricing.context).toBe(200000);
    });

    it('should return cached pricing for Anthropic claude-3-haiku', async () => {
      const result = await client.getModelPricing('anthropic', 'claude-3-haiku');

      expect(result.pricing.input).toBe(0.25);
      expect(result.pricing.output).toBe(1.25);
      expect(result.pricing.cached).toBe(0.03);
    });

    it('should throw error for non-existent model', async () => {
      await expect(client.getModelPricing('openai', 'non-existent-model')).rejects.toThrow(
        /Model 'non-existent-model' not found/
      );
    });

    it('should list available models in error message', async () => {
      try {
        await client.getModelPricing('openai', 'non-existent');
      } catch (err) {
        expect((err as Error).message).toContain('gpt-4o');
        expect((err as Error).message).toContain('gpt-4o-mini');
      }
    });
  });

  describe('getModelPricingOrNull', () => {
    it('should return null for non-existent model', async () => {
      const result = await client.getModelPricingOrNull('openai', 'non-existent-model');
      expect(result).toBeNull();
    });

    it('should return pricing for existing model', async () => {
      const result = await client.getModelPricingOrNull('openai', 'gpt-4o');
      expect(result).not.toBeNull();
      expect(result?.pricing.input).toBe(2.5);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly for simple case', async () => {
      const result = await client.calculateCost('openai', 'gpt-4o', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });

      // gpt-4o: $2.5/M input, $10/M output
      expect(result.inputCost).toBe(2.5);
      expect(result.outputCost).toBe(10);
      expect(result.totalCost).toBe(12.5);
      expect(result.usedCachedPricing).toBe(false);
    });

    it('should calculate cost for small token counts', async () => {
      const result = await client.calculateCost('openai', 'gpt-4o', {
        inputTokens: 1000,
        outputTokens: 500,
      });

      // gpt-4o: $2.5/M input, $10/M output
      // 1000 input = $0.0025, 500 output = $0.005
      expect(result.inputCost).toBeCloseTo(0.0025, 6);
      expect(result.outputCost).toBeCloseTo(0.005, 6);
      expect(result.totalCost).toBeCloseTo(0.0075, 6);
    });

    it('should use cached pricing when available and specified', async () => {
      const result = await client.calculateCost('anthropic', 'claude-3.5-sonnet', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedInputTokens: 800_000,
      });

      // claude-3.5-sonnet: $3/M input, $15/M output, $0.3/M cached
      // 200K regular input = $0.6, 800K cached = $0.24, 500K output = $7.5
      expect(result.inputCost).toBeCloseTo(0.6 + 0.24, 6);
      expect(result.outputCost).toBeCloseTo(7.5, 6);
      expect(result.totalCost).toBeCloseTo(0.6 + 0.24 + 7.5, 6);
      expect(result.usedCachedPricing).toBe(true);
    });

    it('should use regular pricing for cached tokens when model has no cached price', async () => {
      const result = await client.calculateCost('openai', 'gpt-4o', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputTokens: 500_000,
      });

      // gpt-4o has no cached pricing, so all input uses regular price
      // 1M tokens at $2.5/M = $2.5
      expect(result.inputCost).toBe(2.5);
      expect(result.usedCachedPricing).toBe(false);
    });

    it('should include date and stale flag', async () => {
      const result = await client.calculateCost('openai', 'gpt-4o', {
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(result.date).toBe(openaiData.current.date);
      expect(result.stale).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should list all OpenAI models', async () => {
      const models = await client.listModels('openai');

      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toContain('gpt-4-turbo');
      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
      expect(models).toContain('o1');
      expect(models).toContain('o1-mini');
      expect(models).toContain('o1-pro');
      expect(models).toContain('o3-mini');
      expect(models.length).toBe(9);
    });

    it('should list all Anthropic models', async () => {
      const models = await client.listModels('anthropic');

      expect(models).toContain('claude-opus-4');
      expect(models).toContain('claude-sonnet-4');
      expect(models).toContain('claude-3.5-sonnet');
      expect(models).toContain('claude-3.5-haiku');
      expect(models).toContain('claude-3-opus');
      expect(models).toContain('claude-3-sonnet');
      expect(models).toContain('claude-3-haiku');
      expect(models.length).toBe(7);
    });
  });

  describe('stale flag', () => {
    it('should mark data as stale when client date is ahead of data date', async () => {
      // Create client with time set to tomorrow
      const staleClient = new PricingClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        timeOffsetMs: 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000, // Tomorrow noon
      });

      const result = await staleClient.getModelPricing('openai', 'gpt-4o');
      expect(result.stale).toBe(true);
    });

    it('should not mark data as stale when dates match', async () => {
      const result = await client.getModelPricing('openai', 'gpt-4o');
      expect(result.stale).toBe(false);
    });
  });

  describe('caching', () => {
    it('should cache data and not fetch again for same day', async () => {
      let fetchCount = 0;
      const countingFetch = async (url: string): Promise<Response> => {
        fetchCount++;
        return createLocalFetch(DATA_DIR)(url);
      };

      const cachingClient = new PricingClient({
        baseUrl: 'file://local',
        fetch: countingFetch,
        timeOffsetMs: (() => {
          const dataDate = new Date(openaiData.current.date + 'T00:00:00Z').getTime();
          return dataDate - Date.now() + 12 * 60 * 60 * 1000;
        })(),
      });

      // First call should fetch
      await cachingClient.getModelPricing('openai', 'gpt-4o');
      expect(fetchCount).toBe(1);

      // Second call should use cache
      await cachingClient.getModelPricing('openai', 'gpt-4o-mini');
      expect(fetchCount).toBe(1);

      // Different provider should fetch
      await cachingClient.getModelPricing('anthropic', 'claude-sonnet-4');
      expect(fetchCount).toBe(2);

      // Same provider again should use cache
      await cachingClient.getModelPricing('anthropic', 'claude-3-haiku');
      expect(fetchCount).toBe(2);
    });
  });

  describe('ClockMismatchError', () => {
    it('should throw when client clock is way ahead (>1 day)', async () => {
      const aheadClient = new PricingClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        timeOffsetMs: 3 * 24 * 60 * 60 * 1000, // 3 days ahead
      });

      await expect(aheadClient.getModelPricing('openai', 'gpt-4o')).rejects.toThrow(
        ClockMismatchError
      );
    });

    it('should include useful info in ClockMismatchError', async () => {
      const aheadClient = new PricingClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        timeOffsetMs: 3 * 24 * 60 * 60 * 1000,
      });

      try {
        await aheadClient.getModelPricing('openai', 'gpt-4o');
      } catch (err) {
        expect(err).toBeInstanceOf(ClockMismatchError);
        const clockErr = err as ClockMismatchError;
        expect(clockErr.dataDate).toBe(openaiData.current.date);
        expect(clockErr.daysDiff).toBeGreaterThan(1);
      }
    });
  });

  describe('getRawProviderData', () => {
    it('should return full provider file with current and previous', async () => {
      const data = await client.getRawProviderData('openai');

      expect(data.current).toBeDefined();
      expect(data.current.date).toBe(openaiData.current.date);
      expect(data.current.models['gpt-4o']).toBeDefined();

      // Previous may or may not exist depending on data
      if (openaiData.previous) {
        expect(data.previous).toBeDefined();
      }
    });
  });
});

describe('Price verification against known values', () => {
  let client: PricingClient;
  let openaiData: ProviderFile;

  beforeEach(async () => {
    openaiData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'openai.json'), 'utf-8'));

    client = new PricingClient({
      baseUrl: 'file://local',
      fetch: createLocalFetch(DATA_DIR),
      timeOffsetMs: (() => {
        const dataDate = new Date(openaiData.current.date + 'T00:00:00Z').getTime();
        return dataDate - Date.now() + 12 * 60 * 60 * 1000;
      })(),
    });
  });

  it('should have correct OpenAI prices as of data date', async () => {
    // These are the expected prices - test will fail if they change
    const expectedPrices: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4-turbo': { input: 10, output: 30 },
      'gpt-4': { input: 30, output: 60 },
      'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
      'o1': { input: 15, output: 60 },
      'o1-mini': { input: 3, output: 12 },
      'o1-pro': { input: 150, output: 600 },
      'o3-mini': { input: 1.1, output: 4.4 },
    };

    for (const [modelId, expected] of Object.entries(expectedPrices)) {
      const result = await client.getModelPricing('openai', modelId);
      expect(result.pricing.input).toBe(expected.input);
      expect(result.pricing.output).toBe(expected.output);
    }
  });

  it('should have correct Anthropic prices with cached pricing', async () => {
    const expectedPrices: Record<string, { input: number; output: number; cached?: number }> = {
      'claude-opus-4': { input: 15, output: 75 },
      'claude-sonnet-4': { input: 3, output: 15 },
      'claude-3.5-sonnet': { input: 3, output: 15, cached: 0.3 },
      'claude-3.5-haiku': { input: 0.8, output: 4, cached: 0.08 },
      'claude-3-opus': { input: 15, output: 75, cached: 1.5 },
      'claude-3-sonnet': { input: 3, output: 15 },
      'claude-3-haiku': { input: 0.25, output: 1.25, cached: 0.03 },
    };

    for (const [modelId, expected] of Object.entries(expectedPrices)) {
      const result = await client.getModelPricing('anthropic', modelId);
      expect(result.pricing.input).toBe(expected.input);
      expect(result.pricing.output).toBe(expected.output);
      if (expected.cached !== undefined) {
        expect(result.pricing.cached).toBe(expected.cached);
      }
    }
  });
});
