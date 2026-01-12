# Token Prices

Daily-updated LLM pricing data for OpenAI, Anthropic, Google, and OpenRouter.

## What Is This?

An npm package and JSON API that gives you up-to-date token pricing for major LLM providers. Stop hardcoding prices or manually checking pricing pages.

```typescript
import { getModelPricing, calculateCost } from 'token-costs';

// Get pricing info for a model
const pricing = await getModelPricing('openai', 'gpt-4o');
// { input: 2.5, output: 10, context: 128000 }
```

```typescript
// Or calculate cost directly (fetches pricing automatically)
const cost = await calculateCost('anthropic', 'claude-sonnet-4', {
  inputTokens: 1500,
  outputTokens: 800,
});
// { totalCost: 0.0165, ... }
```

Or fetch directly without dependencies:
```javascript
const data = await fetch('https://mikkotikkanen.github.io/token-costs/api/v1/openai.json')
  .then(r => r.json());
```

## Features

- **Daily updates** - Crawled automatically at 00:01 UTC
- **4 providers** - OpenAI, Anthropic, Google, OpenRouter
- **Zero dependencies** - npm package has no runtime dependencies
- **TypeScript** - Full type definitions included
- **Caching** - Fetches once per day, caches automatically
- **Stale detection** - Know when data might be outdated

## Installation

```bash
npm install token-costs
```

## Documentation

Full usage guide, API reference, and data formats: **[mikkotikkanen.github.io/token-costs](https://mikkotikkanen.github.io/token-costs)**

## What's Included

```
token-costs/
├── PricingClient        # Main client class with caching
├── getModelPricing()    # Quick lookup function
├── calculateCost()      # Cost calculation helper
└── TypeScript types     # Full type definitions
```

**API Endpoints** (JSON):
- `api/v1/openai.json`
- `api/v1/anthropic.json`
- `api/v1/google.json`
- `api/v1/openrouter.json`

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
