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
- `src/npm/client.ts` - CostClient (npm package)
- `src/utils/storage.ts` - History read/write functions
- `src/generate-npm-files.ts` - API file generator
- `src/types.ts` - Internal types (crawlers)
- `src/npm/types.ts` - Public types (npm package)

---

## Commits and Releases

We use **conventional commits** for automatic versioning via semantic-release.

**Commit format:**
```
type(scope): description

[optional body]
```

**Version bumps:**
- `fix:` → patch (1.0.x)
- `feat:` → minor (1.x.0)
- `feat!:` or `BREAKING CHANGE:` → major (x.0.0)

**Examples:**
```bash
git commit -m "fix: handle empty API response in OpenRouter crawler"
git commit -m "feat: add support for audio pricing"
git commit -m "feat!: change price format from per-token to per-million"
```

**Release process:**
1. Make changes and commit using conventional commits
2. Push to `main` branch
3. GitHub Actions runs tests, then semantic-release:
   - Analyzes commits since last release
   - Determines version bump
   - Updates package.json version
   - Publishes to npm with provenance
   - Creates GitHub release with changelog

**Manual release (if needed):**
```bash
npm run build && npm test
npx semantic-release --dry-run  # Preview what would happen
```

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
│   │   ├── client.ts          # CostClient class
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
- `src/crawlers/openrouter/index.ts` - API + Playwright (scrapes popularity from provider pages)
- `src/crawlers/anthropic/index.ts`
- `src/crawlers/google/index.ts`

### OpenRouter Model Selection

OpenRouter has hundreds of models. We select only the most popular ones using actual usage data:

1. **Scrape provider pages** - Visit each provider's page on OpenRouter (e.g., `/openai`, `/anthropic`) to get token usage stats
2. **Drop-off heuristic** - Only include models with ≥10% of their provider's top model's usage. This filters out rarely-used models.
3. **Hard caps** - Max 5 models per provider, max 20 total

**Providers scraped:** openai, anthropic, google, deepseek, perplexity, qwen, moonshotai, z-ai, minimax, x-ai

To add a provider to OpenRouter scraping, update `PROVIDERS_TO_SCRAPE` in `src/crawlers/openrouter/index.ts`.

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
- `CostClient` class and all methods
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

## Moi Subagents

Use moi CLI for GitHub operations (PRs, issues, etc.) instead of `gh` CLI.

**Available commands:**
```bash
moi list                              # List available agents (start here)
moi moi/github "<message>"            # Execute GitHub operations
```

**Examples:**
```bash
# Create a PR
moi moi/github "Create a pull request on mikkotikkanen/token-costs from branch feature-branch to main with title 'feat: add feature' and body '## Summary\n- Added feature'"

# Check PR status
moi moi/github "Get the status of PR #1 on mikkotikkanen/token-costs"
```

---

## Important Notes

- Always `npm run build` before testing crawlers
- NPM package has zero runtime dependencies - keep it that way
- Prices are always per million tokens in USD
- Model IDs must match provider API identifiers
- History files are append-only (changes never deleted)
- API files are regenerated from history
- OpenRouter crawler uses Playwright to scrape popularity data from provider pages
- Run `npx playwright install chromium` if browser is missing for OpenRouter crawler
