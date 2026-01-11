import fetch, { RequestInit, Response } from 'node-fetch';

const USER_AGENT = 'token-prices-crawler/1.0 (+https://github.com/anthropics/token-prices; automated price tracking)';

/**
 * Default headers for all requests
 */
const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Fetch with custom User-Agent and error handling
 */
export async function fetchWithUserAgent(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = {
    ...DEFAULT_HEADERS,
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  return response;
}

/**
 * Fetch HTML content from a URL
 */
export async function fetchHtml(url: string): Promise<string> {
  const response = await fetchWithUserAgent(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Fetch JSON content from a URL
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchWithUserAgent(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Sleep for a given number of milliseconds
 * Used for rate limiting between requests
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
