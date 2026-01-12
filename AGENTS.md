# Token Costs - Development Guide

## Documentation Audiences

| File | Audience | Purpose |
|------|----------|---------|
| `README.md` | npm/GitHub visitors | Sales pitch, quick overview, installation, links to docs |
| `docs/index.html` | Users implementing the module | Full manual: API reference, usage examples, data formats |
| `AGENTS.md` | Developers/agents working on this project | Architecture, how to contribute, internal details |

---

## Quick Reference

**What:** NPM package + JSON API for LLM token pricing (OpenAI, Anthropic, Google, OpenRouter)

**How it works:**
- Crawlers scrape provider pricing pages daily at 00:01 UTC
- Changes stored in `history/prices/*.json` (append-only log)
- Compact API files generated in `docs/api/v1/*.json`
- GitHub Pages serves API files
- NPM package fetches + caches API data

**Key commands:**
```bash
npm run build          # Compile TypeScript
npm test               # Run tests
npm run dev:openai     # Build + run OpenAI crawler
npm run generate:npm   # Generate API files from history
```

**Key files:**
- `src/crawlers/base.ts` - BaseCrawler class and helper functions
- `src/npm/client.ts` - PricingClient (npm package)
- `src/utils/storage.ts` - History read/write functions
- `src/generate-npm-files.ts` - API file generator
- `src/types.ts` - Internal types (crawlers)
- `src/npm/types.ts` - Public types (npm package)

---

## Full Development Guide

### Data Flow

```
Provider Sites → Crawlers → history/prices/*.json → generate-npm-files → docs/api/v1/*.json → GitHub Pages → NPM Package
```

### Directory Structure

```
token-costs/
├── src/
│   ├── crawlers/              # Price crawlers
│   │   ├── base.ts            # BaseCrawler class + helpers
│   │   ├── openai/index.ts
│   │   ├── anthropic/index.ts
│   │   ├── google/index.ts
│   │   └── openrouter/index.ts
│   ├── npm/                   # NPM package (published)
│   │   ├── client.ts          # PricingClient class
│   │   ├── types.ts           # Public TypeScript types
│   │   └── index.ts           # Package exports
│   ├── utils/
│   │   ├── storage.ts         # History file read/write
│   │   └── http.ts            # Fetch with user-agent
│   ├── types.ts               # Internal types (crawlers)
│   └── generate-npm-files.ts  # History → API converter
├── history/prices/            # Historical data (committed)
├── docs/
│   ├── index.html             # Documentation site
│   └── api/v1/*.json          # API files (committed)
└── .github/workflows/         # CI/CD
```

### NPM Scripts

See `package.json` for full list. Key scripts:

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm test` | Run tests |
| `npm run dev:{provider}` | Build + run single crawler |
| `npm run test:local` | Test all crawlers locally |
| `npm run generate:npm` | Generate API files |
| `npm run generate:npm -- {provider}` | Generate single provider |

---

## Crawlers

### Base Crawler

All crawlers extend `BaseCrawler`. See `src/crawlers/base.ts` for:
- Abstract class definition
- `parsePrice()` - Parse price strings
- `pricePerKToPerM()` - Convert $/1K to $/1M
- `pricePerTokenToPerM()` - Convert $/token to $/1M

### Implementing a Crawler

Reference existing crawlers for patterns:
- `src/crawlers/openai/index.ts` - HTML scraping with cheerio
- `src/crawlers/openrouter/index.ts` - API-based (JSON endpoint)
- `src/crawlers/anthropic/index.ts`
- `src/crawlers/google/index.ts`

Each crawler must:
1. Extend `BaseCrawler`
2. Set `provider` and `pricingUrl`
3. Implement `crawlPrices()` returning `ModelPricing[]`

### Adding a New Provider

1. Create `src/crawlers/{provider}/index.ts` (reference existing crawlers)
2. Add provider to `Provider` type in `src/types.ts`
3. Add provider to `Provider` type in `src/npm/types.ts`
4. Add scripts to `package.json` (reference existing patterns)
5. Create `.github/workflows/crawl-{provider}.yml` (copy from existing)
6. Test: `npm run build && npm run dev:{provider}`

---

## Storage

See `src/utils/storage.ts` for all storage functions:
- `readProviderHistory()` - Load history file
- `writeProviderHistory()` - Save history file
- `getCurrentSnapshot()` - Build current state from changes
- `detectChanges()` - Compare old vs new prices
- `updateProviderPrices()` - Main update function

### Data Formats

**History format** (`history/prices/*.json`): See `src/types.ts` for `ProviderPriceHistory` interface

**API format** (`docs/api/v1/*.json`): See `src/npm/types.ts` for `ProviderFile` interface

---

## NPM Package

### Published Files

Only `dist/npm/**/*` is published (see `files` in `package.json`)

### Client API

See `src/npm/client.ts` for:
- `PricingClient` class and all methods
- `ClockMismatchError` class
- Convenience functions (`getModelPricing`, `calculateCost`)

See `src/npm/types.ts` for all public types.

---

## Testing

Test files are co-located with source:
- `src/crawlers/base.test.ts`
- `src/crawlers/openrouter/index.test.ts`
- `src/utils/storage.test.ts`
- `src/npm/client.test.ts`

```bash
npm test              # All tests
npm run test:watch    # Watch mode
npm run test:local    # Test crawlers against live sites
```

---

## GitHub Actions

See `.github/workflows/` for:
- `crawl-{provider}.yml` - Daily crawl (00:01 UTC)
- `test.yml` - CI tests
- `release.yml` - npm publish via semantic-release

Crawl workflow steps:
1. Checkout, setup Node, install deps, build
2. Run crawler
3. Generate npm data for that provider
4. Commit and push `history/` and `docs/`

---

## Future Work

### /llm_prices.json Support

See TODO comment in `src/crawlers/base.ts`. Plan:
1. Check for `/llm_prices.json` on provider site first
2. If found, use directly
3. If not found, fall back to scraping

### Multimodal Pricing

See `src/npm/types.ts` for `image`, `audio`, `video` fields in `ModelPricing`. Types exist but crawlers don't collect this yet.

---

## Important Notes

- Always `npm run build` before testing crawlers
- NPM package has zero runtime dependencies - keep it that way
- Prices are always per million tokens in USD
- Model IDs must match provider API identifiers
- History files are append-only (changes never deleted)
- API files are regenerated from history
