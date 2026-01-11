# Token Prices Crawler

An automated system for tracking LLM pricing across providers. Prices are crawled daily and stored as change logs to minimize file size and provide historical tracking.

## Features

- **Daily price updates** via GitHub Actions
- **Change-based storage** - only records when prices actually change
- **Multiple providers**: OpenAI, Anthropic, Google (Gemini), OpenRouter
- **Custom User-Agent** (`token-prices-crawler/1.0`) for easy identification/blocking
- **Price history** - track pricing changes over time
- **"Knock" feature** - checks for machine-readable pricing endpoints

## Data Structure

Prices are stored in `data/prices/{provider}.json` with the following structure:

```json
{
  "provider": "openai",
  "lastCrawled": "2024-01-15T00:00:00.000Z",
  "pricingUrl": "https://openai.com/api/pricing/",
  "changes": [
    {
      "date": "2024-01-01",
      "changeType": "added",
      "pricing": {
        "modelId": "gpt-4o",
        "modelName": "GPT-4o",
        "inputPricePerMillion": 2.5,
        "outputPricePerMillion": 10,
        "contextWindow": 128000
      }
    }
  ]
}
```

## Providers

| Provider | Pricing Page | Update Schedule |
|----------|--------------|-----------------|
| OpenAI | https://openai.com/api/pricing/ | Daily 00:00 UTC |
| Anthropic | https://www.anthropic.com/pricing | Daily 00:05 UTC |
| Google | https://ai.google.dev/pricing | Daily 00:10 UTC |
| OpenRouter | https://openrouter.ai/models | Daily 00:15 UTC |

## Usage

### Installation

```bash
npm install
npm run build
```

### Running Crawlers

```bash
# Run a specific provider
npm run crawl:openai
npm run crawl:anthropic
npm run crawl:google
npm run crawl:openrouter

# Run all providers
npm run crawl:all

# Run the "knock" check for pricing endpoints
npm run knock
```

### Running Tests

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Local Testing (Live Crawl)

Test the crawlers locally against live provider endpoints:

```bash
# Test all crawlers and save results
npm run test:local

# Test a specific provider
npm run test:local:openai
npm run test:local:anthropic
npm run test:local:google
npm run test:local:openrouter

# Just show stored data without crawling
npm run test:local:show
```

### Development Commands

```bash
# Build and run all crawlers
npm run dev

# Build and run a specific crawler
npm run dev:openai
npm run dev:anthropic
npm run dev:google
npm run dev:openrouter

# Run the knock feature
npm run dev:knock

# View stored price data
npm run show:openai
npm run show:anthropic
npm run show:google
npm run show:openrouter
```

## API

You can use this data programmatically:

```typescript
import {
  readProviderHistory,
  getCurrentSnapshot,
} from 'token-prices';

// Get current prices for a provider
const history = await readProviderHistory('openai');
const snapshot = getCurrentSnapshot(history);

console.log(snapshot.models);
// [
//   { modelId: 'gpt-4o', inputPricePerMillion: 2.5, outputPricePerMillion: 10, ... },
//   ...
// ]
```

## For LLM Providers

This project uses web scraping to gather pricing data because there's no standard machine-readable format for LLM pricing.

**We'd love to stop scraping your sites!** If you publish pricing in a machine-readable format, we'll use that instead.

### Proposed Standard: /llm_prices.txt

Similar to `robots.txt`, we propose a simple `/llm_prices.txt` file:

```
# model_id,input_per_million,output_per_million,currency
gpt-4o,2.50,10.00,USD
gpt-4o-mini,0.15,0.60,USD
```

The knock feature (`npm run knock`) checks if providers have added this file.

## Blocking This Crawler

If you'd like to block this crawler, look for the User-Agent: `token-prices-crawler/1.0`

## Contributing

Contributions are welcome! Please open an issue or PR.

## License

MIT
