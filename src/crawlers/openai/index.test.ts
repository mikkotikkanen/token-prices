import { describe, it, expect } from 'vitest';
import { OpenAICrawler } from './index.js';

describe('OpenAICrawler', () => {
  it('should have correct configuration', () => {
    const crawler = new OpenAICrawler();
    expect(crawler.provider).toBe('openai');
    expect(crawler.pricingUrl).toBe('https://platform.openai.com/docs/pricing');
  });

  // Note: The OpenAI crawler uses Playwright for browser automation.
  // Integration tests with actual page parsing require Playwright browsers
  // to be installed and are tested via manual crawl runs.
  // The crawlPrices method is tested end-to-end via npm run crawl:openai
});
