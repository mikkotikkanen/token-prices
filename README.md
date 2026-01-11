# Token Prices

Programmatic access to LLM token pricing for calculating the true cost of API requests.

## Why?

When building applications with LLMs, you need to know what each request actually costs. This project provides up-to-date pricing data for major LLM providers, updated daily, so you can:

- Calculate costs in real-time as requests are made
- Track spending across different models and providers
- Compare pricing between providers
- Build cost dashboards and alerts

## Installation

```bash
npm install token-prices
```

## Usage

```typescript
import { readProviderHistory, getCurrentSnapshot } from 'token-prices';

// Get current prices for a provider
const history = await readProviderHistory('openai');
const snapshot = getCurrentSnapshot(history);

// Find a specific model's pricing
const gpt4o = snapshot.models.find(m => m.modelId === 'gpt-4o');

// Calculate cost for a request
const inputTokens = 1500;
const outputTokens = 500;
const cost =
  (inputTokens / 1_000_000) * gpt4o.inputPricePerMillion +
  (outputTokens / 1_000_000) * gpt4o.outputPricePerMillion;

console.log(`Request cost: $${cost.toFixed(6)}`);
```

## Supported Providers

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4o, GPT-4, GPT-3.5, o1, o3-mini, etc. |
| Anthropic | Claude Opus, Sonnet, Haiku (3, 3.5, 4) |
| Google | Gemini 1.5, 2.0, 2.5 |
| OpenRouter | Top 20 most popular models |

## Data Format

Each model includes:

```typescript
interface ModelPricing {
  modelId: string;                    // e.g., "gpt-4o"
  modelName: string;                  // e.g., "GPT-4o"
  inputPricePerMillion: number;       // USD per 1M input tokens
  outputPricePerMillion: number;      // USD per 1M output tokens
  cachedInputPricePerMillion?: number; // USD per 1M cached tokens (if supported)
  contextWindow?: number;             // Max context size
  maxOutputTokens?: number;           // Max output size
}
```

## How It Works

Prices are fetched daily from provider pricing pages and stored as a changelog. Only price changes are recorded, keeping the data compact while maintaining full history.

Data is stored in `data/prices/{provider}.json`.

## Local Development

```bash
npm install
npm run build
npm test

# Run crawlers locally
npm run test:local
npm run test:local:openai
```

## For LLM Providers

We'd prefer not to scrape your sites. Consider adding `/llm_prices.txt`:

```
# model_id,input_per_million,output_per_million,currency
gpt-4o,2.50,10.00,USD
gpt-4o-mini,0.15,0.60,USD
```

## License

MIT
