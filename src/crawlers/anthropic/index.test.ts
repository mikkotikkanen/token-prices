import { describe, it, expect } from 'vitest';
import { AnthropicCrawler } from './index.js';

describe('AnthropicCrawler', () => {
  it('should have correct configuration', () => {
    const crawler = new AnthropicCrawler();
    expect(crawler.provider).toBe('anthropic');
    expect(crawler.pricingUrl).toBe('https://platform.claude.com/docs/en/about-claude/pricing');
  });

  // Note: The Anthropic crawler uses Playwright for browser automation.
  // Integration tests with actual page parsing require Playwright browsers
  // to be installed and are tested via manual crawl runs.
  // The crawlPrices method is tested end-to-end via npm run crawl:anthropic
});
