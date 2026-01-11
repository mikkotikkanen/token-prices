# Token Prices

Up-to-date LLM token pricing data for calculating the true cost of API requests.

## Why?

When building applications with LLMs, you need to know what each request actually costs. This project provides daily-updated pricing data for major LLM providers.

## Pricing Data

Prices are stored in `data/prices/{provider}.json`:

- [OpenAI](data/prices/openai.json) - GPT-4o, GPT-4, o1, o3-mini, etc.
- [Anthropic](data/prices/anthropic.json) - Claude Opus, Sonnet, Haiku
- [Google](data/prices/google.json) - Gemini models
- [OpenRouter](data/prices/openrouter.json) - Top 20 popular models

## Data Format

```typescript
interface ModelPricing {
  modelId: string;                    // e.g., "gpt-4o"
  modelName: string;                  // e.g., "GPT-4o"
  inputPricePerMillion: number;       // USD per 1M input tokens
  outputPricePerMillion: number;      // USD per 1M output tokens
  cachedInputPricePerMillion?: number; // USD per 1M cached tokens
  contextWindow?: number;             // Max context size
}
```

## How It Works

Prices are fetched daily from provider pricing pages. Only changes are recorded, keeping full history while staying compact.

## For LLM Providers

We'd prefer not to scrape. Consider adding `/llm_prices.txt`:

```
# model_id,input_per_million,output_per_million,currency
gpt-4o,2.50,10.00,USD
```

## License

MIT
