/**
 * Generate human-readable JSON files for the npm module
 * These files are served from GitHub and can be used standalone
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ProviderPriceHistory } from './types.js';
import { getCurrentSnapshot } from './utils/storage.js';
import type { ProviderFile, ProviderData, ModelPricing } from './npm/types.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'prices');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'npm');

type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter';

async function loadHistory(provider: Provider): Promise<ProviderPriceHistory | null> {
  const filePath = path.join(DATA_DIR, `${provider}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function loadPreviousNpmFile(provider: Provider): Promise<ProviderFile | null> {
  const filePath = path.join(OUTPUT_DIR, `${provider}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function historyToProviderData(history: ProviderPriceHistory): ProviderData {
  const snapshot = getCurrentSnapshot(history);
  const date = history.lastCrawled.split('T')[0];

  const models: Record<string, ModelPricing> = {};

  for (const model of snapshot.models) {
    const pricing: ModelPricing = {
      input: model.inputPricePerMillion,
      output: model.outputPricePerMillion,
    };

    if (model.cachedInputPricePerMillion !== undefined) {
      pricing.cached = model.cachedInputPricePerMillion;
    }
    if (model.contextWindow !== undefined) {
      pricing.context = model.contextWindow;
    }
    if (model.maxOutputTokens !== undefined) {
      pricing.maxOutput = model.maxOutputTokens;
    }

    models[model.modelId] = pricing;
  }

  return { date, models };
}

async function generateFiles(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const providers: Provider[] = ['openai', 'anthropic', 'google', 'openrouter'];

  console.log('Generating npm module data files...\n');

  const results: Array<{ provider: string; models: number; size: number }> = [];

  for (const provider of providers) {
    const history = await loadHistory(provider);
    if (!history) {
      console.log(`  ${provider}: no source data`);
      continue;
    }

    const currentData = historyToProviderData(history);

    // Load existing npm file to preserve previous data
    const existingFile = await loadPreviousNpmFile(provider);

    let providerFile: ProviderFile;

    if (existingFile && existingFile.current.date !== currentData.date) {
      // Date changed - move current to previous
      providerFile = {
        current: currentData,
        previous: existingFile.current,
      };
    } else if (existingFile) {
      // Same date - keep previous as is
      providerFile = {
        current: currentData,
        previous: existingFile.previous,
      };
    } else {
      // First time - no previous
      providerFile = {
        current: currentData,
      };
    }

    // Write with 2-space indentation for readability
    const filePath = path.join(OUTPUT_DIR, `${provider}.json`);
    const content = JSON.stringify(providerFile, null, 2);
    await fs.writeFile(filePath, content);

    const modelCount = Object.keys(currentData.models).length;
    results.push({
      provider,
      models: modelCount,
      size: content.length,
    });

    console.log(`  ${provider}.json: ${modelCount} models, ${content.length} bytes`);
  }

  // Summary
  console.log('\n=== Summary ===\n');
  console.log('Provider       | Models | Size');
  console.log('---------------|--------|--------');

  for (const r of results) {
    console.log(
      `${r.provider.padEnd(14)} | ${r.models.toString().padStart(6)} | ${r.size.toString().padStart(5)} B`
    );
  }

  const totalSize = results.reduce((a, r) => a + r.size, 0);
  const totalModels = results.reduce((a, r) => a + r.models, 0);

  console.log('---------------|--------|--------');
  console.log(`${'TOTAL'.padEnd(14)} | ${totalModels.toString().padStart(6)} | ${totalSize.toString().padStart(5)} B`);

  // Show sample
  console.log('\n=== Sample: openai.json ===\n');
  const samplePath = path.join(OUTPUT_DIR, 'openai.json');
  const sample = await fs.readFile(samplePath, 'utf-8');
  console.log(sample);
}

generateFiles().catch(console.error);
