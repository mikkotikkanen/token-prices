/**
 * Knock feature - checks for /llm_prices.txt at LLM provider websites
 *
 * Similar to robots.txt, we propose a simple /llm_prices.txt standard
 * that providers could publish to make pricing data easily accessible.
 *
 * This script "knocks" on each provider's door to check if they've
 * added the file, and gently suggests they consider doing so.
 */

import { fetchWithUserAgent, sleep } from './utils/http.js';

/**
 * Known provider base URLs to check
 */
const PROVIDER_URLS = [
  { name: 'OpenAI', url: 'https://openai.com' },
  { name: 'Anthropic', url: 'https://anthropic.com' },
  { name: 'Google', url: 'https://ai.google.dev' },
  { name: 'OpenRouter', url: 'https://openrouter.ai' },
  { name: 'Mistral', url: 'https://mistral.ai' },
  { name: 'Cohere', url: 'https://cohere.ai' },
  { name: 'Together', url: 'https://together.ai' },
  { name: 'Groq', url: 'https://groq.com' },
  { name: 'Deepseek', url: 'https://deepseek.com' },
];

/**
 * The standard path we're proposing
 */
const PRICING_PATH = '/llm_prices.txt';

/**
 * Result of a knock attempt
 */
interface KnockResult {
  provider: string;
  url: string;
  found: boolean;
  statusCode?: number;
  contentType?: string;
  error?: string;
}

/**
 * Check if a pricing file exists at a URL
 */
async function checkPricingUrl(
  provider: string,
  baseUrl: string,
  path: string
): Promise<KnockResult> {
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetchWithUserAgent(url);

    return {
      provider,
      url,
      found: response.ok,
      statusCode: response.status,
      contentType: response.headers.get('content-type') || undefined,
    };
  } catch (error) {
    return {
      provider,
      url,
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run the knock check for all providers
 */
async function runKnock(): Promise<void> {
  console.log('='.repeat(60));
  console.log('LLM Prices Knock - Checking for /llm_prices.txt');
  console.log('='.repeat(60));
  console.log();
  console.log('Checking if any LLM provider has published /llm_prices.txt');
  console.log('This would make price tracking much simpler than web scraping.');
  console.log();

  const results: KnockResult[] = [];

  for (const provider of PROVIDER_URLS) {
    const result = await checkPricingUrl(provider.name, provider.url, PRICING_PATH);
    results.push(result);

    if (result.found) {
      console.log(`  ✓ ${provider.name}: Found at ${result.url}`);
    } else {
      console.log(`  ✗ ${provider.name}: ${provider.url}${PRICING_PATH} - not found`);
    }

    await sleep(100);
  }

  const found = results.filter(r => r.found);

  console.log();
  console.log('='.repeat(60));

  if (found.length > 0) {
    console.log(`Found ${found.length} provider(s) with /llm_prices.txt!`);
  } else {
    console.log('No providers have /llm_prices.txt yet.');
    console.log();
    console.log('Dear LLM providers - please consider adding /llm_prices.txt');
    console.log('to your website with a simple format like:');
    console.log();
    console.log('  # model_id,input_per_million,output_per_million,currency');
    console.log('  gpt-4o,2.50,10.00,USD');
    console.log('  gpt-4o-mini,0.15,0.60,USD');
    console.log();
    console.log('This would let tools track pricing without scraping your site.');
  }

  console.log();
  console.log('Project: https://github.com/anthropics/token-prices');
  console.log('User-Agent: token-prices-crawler/1.0');
  console.log();
}

// Run if this is the main module
const scriptPath = process.argv[1];
if (scriptPath && scriptPath.includes('knock')) {
  runKnock().catch(error => {
    console.error('Knock failed:', error);
    process.exit(1);
  });
}

export { runKnock, checkPricingUrl };
