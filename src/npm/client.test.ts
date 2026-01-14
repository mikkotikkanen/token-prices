import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CostClient, ClockMismatchError } from './client.js';
import type { ProviderFile } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'docs', 'api', 'v1');

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

describe('CostClient', () => {
  let client: CostClient;
  let openaiData: ProviderFile;
  let anthropicData: ProviderFile;

  beforeEach(async () => {
    // Load the actual data files for reference
    openaiData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'openai.json'), 'utf-8'));
    anthropicData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'anthropic.json'), 'utf-8'));

    // Create client with mock fetch pointing to local files
    client = new CostClient({
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
      expect(result.pricing.cached).toBe(1.25);
      expect(result.date).toBe(openaiData.current.date);
      expect(result.stale).toBe(false);
    });

    it('should return correct pricing for OpenAI gpt-4o-mini', async () => {
      const result = await client.getModelPricing('openai', 'gpt-4o-mini');

      expect(result.pricing.input).toBe(0.15);
      expect(result.pricing.output).toBe(0.6);
      expect(result.pricing.cached).toBe(0.075);
    });

    it('should return correct pricing for OpenAI o1-pro (most expensive)', async () => {
      const result = await client.getModelPricing('openai', 'o1-pro');

      expect(result.pricing.input).toBe(150);
      expect(result.pricing.output).toBe(600);
    });

    it('should return correct pricing for Anthropic claude-sonnet-4', async () => {
      const result = await client.getModelPricing('anthropic', 'claude-sonnet-4');

      expect(result.provider).toBe('anthropic');
      expect(result.pricing.input).toBe(3);
      expect(result.pricing.output).toBe(15);
      expect(result.pricing.cached).toBe(0.3);
    });

    it('should return cached pricing for Anthropic claude-opus-4.5', async () => {
      const result = await client.getModelPricing('anthropic', 'claude-opus-4.5');

      expect(result.pricing.input).toBe(5);
      expect(result.pricing.output).toBe(25);
      expect(result.pricing.cached).toBe(0.5);
    });

    it('should return cached pricing for Anthropic claude-haiku-3', async () => {
      const result = await client.getModelPricing('anthropic', 'claude-haiku-3');

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
      const result = await client.calculateCost('anthropic', 'claude-sonnet-4', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedInputTokens: 800_000,
      });

      // claude-sonnet-4: $3/M input, $15/M output, $0.3/M cached
      // 200K regular input = $0.6, 800K cached = $0.24, 500K output = $7.5
      expect(result.inputCost).toBeCloseTo(0.6 + 0.24, 6);
      expect(result.outputCost).toBeCloseTo(7.5, 6);
      expect(result.totalCost).toBeCloseTo(0.6 + 0.24 + 7.5, 6);
      expect(result.usedCachedPricing).toBe(true);
    });

    it('should use cached pricing for gpt-4o when available', async () => {
      const result = await client.calculateCost('openai', 'gpt-4o', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputTokens: 500_000,
      });

      // gpt-4o: $2.5/M input, $1.25/M cached
      // 500K regular input = $1.25, 500K cached = $0.625
      expect(result.inputCost).toBeCloseTo(1.25 + 0.625, 6);
      expect(result.usedCachedPricing).toBe(true);
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
      expect(models).toContain('gpt-5.2');
      expect(models).toContain('gpt-5');
      expect(models).toContain('o1');
      expect(models).toContain('o1-mini');
      expect(models).toContain('o1-pro');
      expect(models).toContain('o3-mini');
      expect(models.length).toBe(33);
    });

    it('should list all Anthropic models', async () => {
      const models = await client.listModels('anthropic');

      expect(models).toContain('claude-opus-4.5');
      expect(models).toContain('claude-opus-4');
      expect(models).toContain('claude-sonnet-4');
      expect(models).toContain('claude-sonnet-4.5');
      expect(models).toContain('claude-haiku-4.5');
      expect(models).toContain('claude-haiku-3.5');
      expect(models).toContain('claude-haiku-3');
      expect(models.length).toBe(10);
    });
  });

  describe('stale flag', () => {
    it('should mark data as stale when client date is ahead of data date', async () => {
      // Create client with time set to 1 day after data date (noon)
      // This gives daysDiff = 1, which passes the >1 check but sets stale=true
      const staleClient = new CostClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        timeOffsetMs: (() => {
          const dataDate = new Date(openaiData.current.date + 'T00:00:00Z').getTime();
          const now = Date.now();
          // Set to noon on the day AFTER data date
          return dataDate - now + 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
        })(),
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

      const cachingClient = new CostClient({
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
      await cachingClient.getModelPricing('anthropic', 'claude-haiku-3');
      expect(fetchCount).toBe(2);
    });
  });

  describe('ClockMismatchError', () => {
    it('should throw when client clock is way ahead (>1 day)', async () => {
      const aheadClient = new CostClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        timeOffsetMs: 3 * 24 * 60 * 60 * 1000, // 3 days ahead
      });

      await expect(aheadClient.getModelPricing('openai', 'gpt-4o')).rejects.toThrow(
        ClockMismatchError
      );
    });

    it('should include useful info in ClockMismatchError', async () => {
      const aheadClient = new CostClient({
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

describe('Custom providers and offline mode', () => {
  let openaiData: ProviderFile;

  beforeEach(async () => {
    openaiData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'openai.json'), 'utf-8'));
  });

  describe('offline mode', () => {
    it('should work with custom providers in offline mode', async () => {
      const client = new CostClient({
        offline: true,
        customProviders: {
          'my-company': {
            'internal-llm': { input: 0.5, output: 1.0, context: 32000 },
          },
        },
      });

      const result = await client.getModelPricing('my-company', 'internal-llm');
      expect(result.pricing.input).toBe(0.5);
      expect(result.pricing.output).toBe(1.0);
      expect(result.pricing.context).toBe(32000);
    });

    it('should throw error for built-in provider in offline mode without custom data', async () => {
      const client = new CostClient({
        offline: true,
      });

      await expect(client.getModelPricing('openai', 'gpt-4o')).rejects.toThrow(
        /Provider 'openai' not found.*offline mode/
      );
    });

    it('should allow overriding built-in providers in offline mode', async () => {
      const client = new CostClient({
        offline: true,
        customProviders: {
          openai: {
            'gpt-4o': { input: 999, output: 999 },
          },
        },
      });

      const result = await client.getModelPricing('openai', 'gpt-4o');
      expect(result.pricing.input).toBe(999);
      expect(result.pricing.output).toBe(999);
    });
  });

  describe('custom providers (online mode)', () => {
    it('should merge custom models with remote data', async () => {
      const client = new CostClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        customProviders: {
          openai: {
            'my-custom-gpt': { input: 100, output: 200 },
          },
        },
        timeOffsetMs: (() => {
          const dataDate = new Date(openaiData.current.date + 'T00:00:00Z').getTime();
          return dataDate - Date.now() + 12 * 60 * 60 * 1000;
        })(),
      });

      // Custom model should work
      const customResult = await client.getModelPricing('openai', 'my-custom-gpt');
      expect(customResult.pricing.input).toBe(100);
      expect(customResult.pricing.output).toBe(200);

      // Remote model should still work
      const remoteResult = await client.getModelPricing('openai', 'gpt-4o');
      expect(remoteResult.pricing.input).toBe(2.5);
    });

    it('should allow custom data to override remote data', async () => {
      const client = new CostClient({
        baseUrl: 'file://local',
        fetch: createLocalFetch(DATA_DIR),
        customProviders: {
          openai: {
            'gpt-4o': { input: 999, output: 888 }, // Override remote
          },
        },
        timeOffsetMs: (() => {
          const dataDate = new Date(openaiData.current.date + 'T00:00:00Z').getTime();
          return dataDate - Date.now() + 12 * 60 * 60 * 1000;
        })(),
      });

      const result = await client.getModelPricing('openai', 'gpt-4o');
      expect(result.pricing.input).toBe(999);
      expect(result.pricing.output).toBe(888);
    });

    it('should support entirely custom providers without remote data', async () => {
      const client = new CostClient({
        customProviders: {
          'my-company': {
            'model-a': { input: 1, output: 2 },
            'model-b': { input: 3, output: 4 },
          },
        },
      });

      const resultA = await client.getModelPricing('my-company', 'model-a');
      expect(resultA.pricing.input).toBe(1);

      const resultB = await client.getModelPricing('my-company', 'model-b');
      expect(resultB.pricing.output).toBe(4);
    });

    it('should throw for unknown custom provider model', async () => {
      const client = new CostClient({
        customProviders: {
          'my-company': {
            'model-a': { input: 1, output: 2 },
          },
        },
      });

      await expect(client.getModelPricing('my-company', 'non-existent')).rejects.toThrow(
        /Model 'non-existent' not found/
      );
    });

    it('should throw for unknown provider', async () => {
      const client = new CostClient({
        offline: true,
      });

      await expect(client.getModelPricing('unknown-provider', 'model')).rejects.toThrow(
        /Provider 'unknown-provider' not found/
      );
    });
  });

  describe('calculateCost with custom providers', () => {
    it('should calculate cost using custom pricing', async () => {
      const client = new CostClient({
        offline: true,
        customProviders: {
          'my-company': {
            'internal-llm': { input: 10, output: 20 }, // $10/M input, $20/M output
          },
        },
      });

      const result = await client.calculateCost('my-company', 'internal-llm', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      });

      expect(result.inputCost).toBe(10);
      expect(result.outputCost).toBe(10);
      expect(result.totalCost).toBe(20);
    });
  });

  describe('listModels with custom providers', () => {
    it('should list models for custom provider', async () => {
      const client = new CostClient({
        offline: true,
        customProviders: {
          'my-company': {
            'model-a': { input: 1, output: 2 },
            'model-b': { input: 3, output: 4 },
          },
        },
      });

      const models = await client.listModels('my-company');
      expect(models).toContain('model-a');
      expect(models).toContain('model-b');
      expect(models.length).toBe(2);
    });
  });
});

describe('Price verification against known values', () => {
  let client: CostClient;
  let openaiData: ProviderFile;

  beforeEach(async () => {
    openaiData = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'openai.json'), 'utf-8'));

    client = new CostClient({
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
      'gpt-5.2': { input: 1.75, output: 14 },
      'gpt-5': { input: 1.25, output: 10 },
      'gpt-5-mini': { input: 0.25, output: 2 },
      'o1': { input: 15, output: 60 },
      'o1-mini': { input: 1.1, output: 4.4 },
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
      'claude-opus-4.5': { input: 5, output: 25, cached: 0.5 },
      'claude-opus-4': { input: 15, output: 75, cached: 1.5 },
      'claude-sonnet-4': { input: 3, output: 15, cached: 0.3 },
      'claude-sonnet-4.5': { input: 3, output: 15, cached: 0.3 },
      'claude-haiku-4.5': { input: 1, output: 5, cached: 0.1 },
      'claude-haiku-3.5': { input: 0.8, output: 4, cached: 0.08 },
      'claude-haiku-3': { input: 0.25, output: 1.25, cached: 0.03 },
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

describe('Deprecation handling', () => {
  // Create a mock fetch that returns deprecated data
  function createDeprecatedFetch() {
    return async (): Promise<Response> => {
      const deprecatedData = {
        current: {
          date: getUtcDate(),
          models: {
            'test-model': { input: 1, output: 2 },
          },
        },
        deprecated: {
          since: '2025-01-01',
          dataFrozenAt: '2025-02-01',
          message: 'This endpoint is deprecated. Please upgrade to v2.',
          upgradeGuide: 'https://example.com/upgrade',
        },
      };
      return new Response(JSON.stringify(deprecatedData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  it('should call onDeprecation callback when deprecated endpoint is accessed', async () => {
    let deprecationCalled = false;
    let receivedInfo: unknown = null;
    let receivedProvider: unknown = null;

    const client = new CostClient({
      baseUrl: 'file://test',
      fetch: createDeprecatedFetch(),
      onDeprecation: (info, provider) => {
        deprecationCalled = true;
        receivedInfo = info;
        receivedProvider = provider;
      },
    });

    await client.getModelPricing('openai', 'test-model');

    expect(deprecationCalled).toBe(true);
    expect(receivedProvider).toBe('openai');
    expect(receivedInfo).toEqual({
      since: '2025-01-01',
      dataFrozenAt: '2025-02-01',
      message: 'This endpoint is deprecated. Please upgrade to v2.',
      upgradeGuide: 'https://example.com/upgrade',
    });
  });

  it('should only call onDeprecation once per provider', async () => {
    let callCount = 0;

    const client = new CostClient({
      baseUrl: 'file://test',
      fetch: createDeprecatedFetch(),
      onDeprecation: () => {
        callCount++;
      },
    });

    await client.getModelPricing('openai', 'test-model');
    await client.getModelPricing('openai', 'test-model');
    await client.getModelPricing('openai', 'test-model');

    expect(callCount).toBe(1);
  });

  it('should not call onDeprecation when suppressDeprecationWarnings is true', async () => {
    let deprecationCalled = false;

    const client = new CostClient({
      baseUrl: 'file://test',
      fetch: createDeprecatedFetch(),
      suppressDeprecationWarnings: true,
      onDeprecation: () => {
        deprecationCalled = true;
      },
    });

    await client.getModelPricing('openai', 'test-model');

    // onDeprecation should still be called even with suppressDeprecationWarnings
    // suppressDeprecationWarnings only suppresses console.warn
    expect(deprecationCalled).toBe(true);
  });

  it('should use console.warn by default for deprecated endpoints', async () => {
    const originalWarn = console.warn;
    let warnCalled = false;
    let warnMessage = '';

    console.warn = (msg: string) => {
      warnCalled = true;
      warnMessage = msg;
    };

    try {
      const client = new CostClient({
        baseUrl: 'file://test',
        fetch: createDeprecatedFetch(),
      });

      await client.getModelPricing('openai', 'test-model');

      expect(warnCalled).toBe(true);
      expect(warnMessage).toContain('DEPRECATION WARNING');
      expect(warnMessage).toContain('openai');
      expect(warnMessage).toContain('2025-01-01');
      expect(warnMessage).toContain('2025-02-01');
      expect(warnMessage).toContain('https://example.com/upgrade');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should not console.warn when suppressDeprecationWarnings is true', async () => {
    const originalWarn = console.warn;
    let warnCalled = false;

    console.warn = () => {
      warnCalled = true;
    };

    try {
      const client = new CostClient({
        baseUrl: 'file://test',
        fetch: createDeprecatedFetch(),
        suppressDeprecationWarnings: true,
      });

      await client.getModelPricing('openai', 'test-model');

      expect(warnCalled).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should not warn for non-deprecated endpoints', async () => {
    let deprecationCalled = false;

    // Create fetch that returns non-deprecated data
    const nonDeprecatedFetch = async (): Promise<Response> => {
      const data = {
        current: {
          date: getUtcDate(),
          models: {
            'test-model': { input: 1, output: 2 },
          },
        },
        // No deprecated field
      };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new CostClient({
      baseUrl: 'file://test',
      fetch: nonDeprecatedFetch,
      onDeprecation: () => {
        deprecationCalled = true;
      },
    });

    await client.getModelPricing('openai', 'test-model');

    expect(deprecationCalled).toBe(false);
  });
});
