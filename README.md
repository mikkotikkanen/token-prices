# Token Costs

Daily-updated LLM pricing data for OpenAI, Anthropic, Google, and OpenRouter.

## What Is This?

An npm package and JSON API that gives you up-to-date token pricing for major LLM providers. Stop hardcoding prices or manually checking pricing pages.

```typescript
import { CostClient } from 'token-costs';

// Create a client (fetches from remote API)
const client = new CostClient();

// Get pricing for a model
const result = await client.getModelPricing('openai', 'gpt-4o');
console.log(`Input: $${result.pricing.input}/M tokens`);
console.log(`Output: $${result.pricing.output}/M tokens`);

// Calculate cost for an API call
const cost = await client.calculateCost('anthropic', 'claude-sonnet-4', {
  inputTokens: 1500,
  outputTokens: 800,
});
console.log(`Total cost: $${cost.totalCost.toFixed(6)}`);

// OpenRouter models use provider/model format
const orPricing = await client.getModelPricing('openrouter', 'anthropic/claude-3.5-sonnet');
```

Or fetch directly without dependencies:
```javascript
const data = await fetch('https://mikkotikkanen.github.io/token-costs/api/v1/openai.json')
  .then(r => r.json());
```

## Features

- **Daily updates** - Crawled automatically at 00:01 UTC
- **4 providers** - OpenAI, Anthropic, Google, OpenRouter
- **Custom providers** - Add your own models or override pricing
- **Offline mode** - Work without network access using custom data
- **Zero dependencies** - npm package has no runtime dependencies
- **TypeScript** - Full type definitions included
- **Caching** - Fetches once per day, caches automatically
- **Stale detection** - Know when data might be outdated

## Installation

```bash
npm install token-costs
```

## Custom Providers & Offline Mode

Add custom models or use entirely custom pricing data:

```typescript
// Add custom models alongside remote data
const client = new CostClient({
  customProviders: {
    'my-company': {
      'internal-llm': { input: 0.50, output: 1.00 }
    },
    'openai': {
      'gpt-4-custom': { input: 25, output: 50 } // Override/add to openai
    }
  }
});

// Offline mode - no remote fetching
const offlineClient = new CostClient({
  offline: true,
  customProviders: {
    'openai': {
      'gpt-4o': { input: 2.5, output: 10 }
    }
  }
});
```

## Documentation

Full usage guide, API reference, and data formats: **[mikkotikkanen.github.io/token-costs](https://mikkotikkanen.github.io/token-costs)**

## What's Included

```
token-costs/
├── CostClient        # Main client class with caching
└── TypeScript types     # Full type definitions
```

**API Endpoints** (JSON):
- `api/v1/openai.json`
- `api/v1/anthropic.json`
- `api/v1/google.json`
- `api/v1/openrouter/{provider}.json` - Per-provider files (anthropic, openai, google, deepseek, etc.)

## Contributing

Found incorrect pricing? Want to add a provider? Contributions welcome!

```bash
git clone https://github.com/mikkotikkanen/token-costs
cd token-costs
npm install
npm run build
npm test
```

See [AGENTS.md](AGENTS.md) for development details.

## For LLM Providers

We'd prefer not to scrape. Consider publishing `/llm_prices.json` on your website - a simple standard format that tools can fetch directly. See the [full proposal](https://mikkotikkanen.github.io/token-costs/#proposal) on the documentation site.

## License

MIT
