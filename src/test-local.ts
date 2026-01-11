/**
 * Local test script for validating crawlers
 * Run with: npm run test:local
 *
 * This script runs each crawler with mock data to validate the parsing logic works.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { OpenAICrawler } from './crawlers/openai/index.js';
import { AnthropicCrawler } from './crawlers/anthropic/index.js';
import { GoogleCrawler } from './crawlers/google/index.js';
import { OpenRouterCrawler } from './crawlers/openrouter/index.js';
import { getCurrentSnapshot, readProviderHistory } from './utils/storage.js';
import { Provider } from './types.js';

interface TestResult {
  provider: string;
  success: boolean;
  modelCount: number;
  error?: string;
  sampleModels?: Array<{ id: string; input: number; output: number }>;
}

async function testCrawler(
  name: string,
  crawlFn: () => Promise<any>
): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${name}...`);
  console.log('='.repeat(60));

  try {
    const result = await crawlFn();

    if (!result.success) {
      return {
        provider: name,
        success: false,
        modelCount: 0,
        error: result.error,
      };
    }

    const sampleModels = result.prices.slice(0, 3).map((p: any) => ({
      id: p.modelId,
      input: p.inputPricePerMillion,
      output: p.outputPricePerMillion,
    }));

    console.log(`✓ Found ${result.prices.length} models`);
    console.log('\nSample models:');
    for (const model of sampleModels) {
      console.log(`  - ${model.id}: $${model.input}/$${model.output} per 1M`);
    }

    return {
      provider: name,
      success: true,
      modelCount: result.prices.length,
      sampleModels,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`✗ Failed: ${errorMessage}`);

    return {
      provider: name,
      success: false,
      modelCount: 0,
      error: errorMessage,
    };
  }
}

async function showStoredData() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Stored Price Data');
  console.log('='.repeat(60));

  const providers: Provider[] = ['openai', 'anthropic', 'google', 'openrouter'];

  for (const provider of providers) {
    try {
      const history = await readProviderHistory(provider);
      if (history) {
        const snapshot = getCurrentSnapshot(history);
        console.log(`\n${provider}:`);
        console.log(`  - Last crawled: ${history.lastCrawled}`);
        console.log(`  - Total changes: ${history.changes.length}`);
        console.log(`  - Current models: ${snapshot.models.length}`);

        if (snapshot.models.length > 0) {
          console.log('  - Sample models:');
          for (const model of snapshot.models.slice(0, 3)) {
            console.log(
              `    • ${model.modelId}: $${model.inputPricePerMillion}/$${model.outputPricePerMillion}`
            );
          }
        }
      } else {
        console.log(`\n${provider}: No data yet`);
      }
    } catch (error) {
      console.log(`\n${provider}: Error reading data`);
    }
  }
}

async function main() {
  console.log('Token Prices Crawler - Local Test');
  console.log('==================================\n');

  const args = process.argv.slice(2);
  const showOnly = args.includes('--show');
  const provider = args.find((a) => !a.startsWith('-'));

  if (showOnly) {
    await showStoredData();
    return;
  }

  const results: TestResult[] = [];

  // Run crawlers based on argument or all
  if (!provider || provider === 'openai') {
    const crawler = new OpenAICrawler();
    results.push(await testCrawler('OpenAI', () => crawler.run()));
  }

  if (!provider || provider === 'anthropic') {
    const crawler = new AnthropicCrawler();
    results.push(await testCrawler('Anthropic', () => crawler.run()));
  }

  if (!provider || provider === 'google') {
    const crawler = new GoogleCrawler();
    results.push(await testCrawler('Google', () => crawler.run()));
  }

  if (!provider || provider === 'openrouter') {
    const crawler = new OpenRouterCrawler();
    results.push(await testCrawler('OpenRouter', () => crawler.run()));
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\nTotal: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`);

  if (passed.length > 0) {
    console.log('\n✓ Passed:');
    for (const result of passed) {
      console.log(`  - ${result.provider}: ${result.modelCount} models`);
    }
  }

  if (failed.length > 0) {
    console.log('\n✗ Failed:');
    for (const result of failed) {
      console.log(`  - ${result.provider}: ${result.error}`);
    }
  }

  // Show stored data
  await showStoredData();

  // Exit with error if any failed
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
