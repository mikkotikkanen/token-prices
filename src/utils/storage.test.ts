import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  detectChanges,
  getCurrentSnapshot,
  readProviderHistory,
  writeProviderHistory,
  updateProviderPrices,
  ensureDataDirs,
} from './storage.js';
import { ModelPricing, ProviderPriceHistory } from '../types.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'history', 'test-prices');

describe('Storage Utils', () => {
  beforeEach(async () => {
    // Ensure test directory exists
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true });
    } catch {
      // Directory might not exist
    }
  });

  describe('detectChanges', () => {
    it('should detect added models', () => {
      const currentPrices: ModelPricing[] = [];
      const newPrices: ModelPricing[] = [
        {
          modelId: 'gpt-4',
          modelName: 'GPT-4',
          inputPricePerMillion: 30,
          outputPricePerMillion: 60,
        },
      ];

      const changes = detectChanges(currentPrices, newPrices, '2024-01-15');

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('added');
      expect(changes[0].pricing.modelId).toBe('gpt-4');
    });

    it('should detect removed models', () => {
      const currentPrices: ModelPricing[] = [
        {
          modelId: 'gpt-3.5-turbo',
          modelName: 'GPT-3.5 Turbo',
          inputPricePerMillion: 0.5,
          outputPricePerMillion: 1.5,
        },
      ];
      const newPrices: ModelPricing[] = [];

      const changes = detectChanges(currentPrices, newPrices, '2024-01-15');

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('removed');
      expect(changes[0].pricing.modelId).toBe('gpt-3.5-turbo');
    });

    it('should detect updated prices', () => {
      const currentPrices: ModelPricing[] = [
        {
          modelId: 'gpt-4',
          modelName: 'GPT-4',
          inputPricePerMillion: 30,
          outputPricePerMillion: 60,
        },
      ];
      const newPrices: ModelPricing[] = [
        {
          modelId: 'gpt-4',
          modelName: 'GPT-4',
          inputPricePerMillion: 25,
          outputPricePerMillion: 50,
        },
      ];

      const changes = detectChanges(currentPrices, newPrices, '2024-01-15');

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('updated');
      expect(changes[0].pricing.inputPricePerMillion).toBe(25);
      expect(changes[0].previousPricing?.inputPricePerMillion).toBe(30);
    });

    it('should not detect changes when prices are the same', () => {
      const currentPrices: ModelPricing[] = [
        {
          modelId: 'gpt-4',
          modelName: 'GPT-4',
          inputPricePerMillion: 30,
          outputPricePerMillion: 60,
        },
      ];

      const changes = detectChanges(currentPrices, [...currentPrices], '2024-01-15');

      expect(changes).toHaveLength(0);
    });

    it('should handle multiple changes at once', () => {
      const currentPrices: ModelPricing[] = [
        {
          modelId: 'model-a',
          modelName: 'Model A',
          inputPricePerMillion: 10,
          outputPricePerMillion: 20,
        },
        {
          modelId: 'model-b',
          modelName: 'Model B',
          inputPricePerMillion: 5,
          outputPricePerMillion: 10,
        },
      ];
      const newPrices: ModelPricing[] = [
        {
          modelId: 'model-a',
          modelName: 'Model A',
          inputPricePerMillion: 8, // Price changed
          outputPricePerMillion: 16,
        },
        // model-b removed
        {
          modelId: 'model-c',
          modelName: 'Model C', // New model
          inputPricePerMillion: 15,
          outputPricePerMillion: 30,
        },
      ];

      const changes = detectChanges(currentPrices, newPrices, '2024-01-15');

      expect(changes).toHaveLength(3);

      const updated = changes.find(c => c.changeType === 'updated');
      const removed = changes.find(c => c.changeType === 'removed');
      const added = changes.find(c => c.changeType === 'added');

      expect(updated?.pricing.modelId).toBe('model-a');
      expect(removed?.pricing.modelId).toBe('model-b');
      expect(added?.pricing.modelId).toBe('model-c');
    });
  });

  describe('getCurrentSnapshot', () => {
    it('should build snapshot from changes', () => {
      const history: ProviderPriceHistory = {
        provider: 'openai',
        lastCrawled: '2024-01-15T00:00:00Z',
        pricingUrl: 'https://openai.com/pricing',
        changes: [
          {
            date: '2024-01-01',
            changeType: 'added',
            pricing: {
              modelId: 'gpt-4',
              modelName: 'GPT-4',
              inputPricePerMillion: 30,
              outputPricePerMillion: 60,
            },
          },
          {
            date: '2024-01-10',
            changeType: 'added',
            pricing: {
              modelId: 'gpt-3.5-turbo',
              modelName: 'GPT-3.5 Turbo',
              inputPricePerMillion: 0.5,
              outputPricePerMillion: 1.5,
            },
          },
          {
            date: '2024-01-15',
            changeType: 'updated',
            pricing: {
              modelId: 'gpt-4',
              modelName: 'GPT-4',
              inputPricePerMillion: 25,
              outputPricePerMillion: 50,
            },
          },
        ],
      };

      const snapshot = getCurrentSnapshot(history);

      expect(snapshot.models).toHaveLength(2);

      const gpt4 = snapshot.models.find(m => m.modelId === 'gpt-4');
      expect(gpt4?.inputPricePerMillion).toBe(25); // Updated price

      const gpt35 = snapshot.models.find(m => m.modelId === 'gpt-3.5-turbo');
      expect(gpt35?.inputPricePerMillion).toBe(0.5);
    });

    it('should handle removed models', () => {
      const history: ProviderPriceHistory = {
        provider: 'openai',
        lastCrawled: '2024-01-15T00:00:00Z',
        pricingUrl: 'https://openai.com/pricing',
        changes: [
          {
            date: '2024-01-01',
            changeType: 'added',
            pricing: {
              modelId: 'old-model',
              modelName: 'Old Model',
              inputPricePerMillion: 10,
              outputPricePerMillion: 20,
            },
          },
          {
            date: '2024-01-15',
            changeType: 'removed',
            pricing: {
              modelId: 'old-model',
              modelName: 'Old Model',
              inputPricePerMillion: 10,
              outputPricePerMillion: 20,
            },
          },
        ],
      };

      const snapshot = getCurrentSnapshot(history);

      expect(snapshot.models).toHaveLength(0);
    });
  });
});

