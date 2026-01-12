import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ModelPricing,
  PriceChange,
  Provider,
  ProviderPriceHistory,
  ProviderPriceSnapshot
} from '../types.js';

const HISTORY_DIR = path.join(process.cwd(), 'history');
const PRICES_DIR = path.join(HISTORY_DIR, 'prices');

/**
 * Ensure data directories exist
 */
export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.mkdir(PRICES_DIR, { recursive: true });
}

/**
 * Get the path to a provider's price history file
 */
function getProviderFilePath(provider: Provider): string {
  return path.join(PRICES_DIR, `${provider}.json`);
}

/**
 * Read provider price history
 */
export async function readProviderHistory(
  provider: Provider
): Promise<ProviderPriceHistory | null> {
  const filePath = getProviderFilePath(provider);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ProviderPriceHistory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write provider price history
 */
export async function writeProviderHistory(
  history: ProviderPriceHistory
): Promise<void> {
  await ensureDataDirs();
  const filePath = getProviderFilePath(history.provider as Provider);
  await fs.writeFile(filePath, JSON.stringify(history, null, 2));
}

/**
 * Get current snapshot from history by applying all changes
 */
export function getCurrentSnapshot(
  history: ProviderPriceHistory
): ProviderPriceSnapshot {
  const modelsMap = new Map<string, ModelPricing>();

  for (const change of history.changes) {
    switch (change.changeType) {
      case 'added':
      case 'updated':
        modelsMap.set(change.pricing.modelId, change.pricing);
        break;
      case 'removed':
        modelsMap.delete(change.pricing.modelId);
        break;
    }
  }

  return {
    provider: history.provider,
    date: history.lastCrawled,
    models: Array.from(modelsMap.values()),
  };
}

/**
 * Compare two ModelPricing objects for equality
 */
function arePricingsEqual(a: ModelPricing, b: ModelPricing): boolean {
  return (
    a.modelId === b.modelId &&
    a.inputPricePerMillion === b.inputPricePerMillion &&
    a.outputPricePerMillion === b.outputPricePerMillion &&
    a.cachedInputPricePerMillion === b.cachedInputPricePerMillion &&
    a.contextWindow === b.contextWindow &&
    a.maxOutputTokens === b.maxOutputTokens
  );
}

/**
 * Detect changes between current prices and new prices
 */
export function detectChanges(
  currentPrices: ModelPricing[],
  newPrices: ModelPricing[],
  date: string
): PriceChange[] {
  const changes: PriceChange[] = [];
  const currentMap = new Map(currentPrices.map(p => [p.modelId, p]));
  const newMap = new Map(newPrices.map(p => [p.modelId, p]));

  // Check for added and updated models
  for (const [modelId, newPricing] of newMap) {
    const currentPricing = currentMap.get(modelId);

    if (!currentPricing) {
      // New model added
      changes.push({
        date,
        changeType: 'added',
        pricing: newPricing,
      });
    } else if (!arePricingsEqual(currentPricing, newPricing)) {
      // Model pricing updated
      changes.push({
        date,
        changeType: 'updated',
        pricing: newPricing,
        previousPricing: currentPricing,
      });
    }
  }

  // Check for removed models
  for (const [modelId, currentPricing] of currentMap) {
    if (!newMap.has(modelId)) {
      changes.push({
        date,
        changeType: 'removed',
        pricing: currentPricing,
      });
    }
  }

  return changes;
}

/**
 * Update provider history with new prices
 * Returns the changes that were made
 */
export async function updateProviderPrices(
  provider: Provider,
  pricingUrl: string,
  newPrices: ModelPricing[]
): Promise<PriceChange[]> {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  let history = await readProviderHistory(provider);

  if (!history) {
    // First time crawling this provider - all models are "added"
    const changes: PriceChange[] = newPrices.map(pricing => ({
      date: today,
      changeType: 'added' as const,
      pricing,
    }));

    history = {
      provider,
      lastCrawled: now,
      pricingUrl,
      changes,
    };

    await writeProviderHistory(history);
    return changes;
  }

  // Get current snapshot and detect changes
  const currentSnapshot = getCurrentSnapshot(history);
  const changes = detectChanges(currentSnapshot.models, newPrices, today);

  if (changes.length > 0) {
    history.changes.push(...changes);
  }

  history.lastCrawled = now;
  await writeProviderHistory(history);

  return changes;
}

/**
 * Get a summary of all providers and their model counts
 */
export async function getProvidersSummary(): Promise<
  Array<{
    provider: string;
    modelCount: number;
    lastCrawled: string;
    totalChanges: number;
  }>
> {
  await ensureDataDirs();

  const providers: Provider[] = ['openai', 'anthropic', 'google', 'openrouter'];
  const summaries = [];

  for (const provider of providers) {
    const history = await readProviderHistory(provider);
    if (history) {
      const snapshot = getCurrentSnapshot(history);
      summaries.push({
        provider: history.provider,
        modelCount: snapshot.models.length,
        lastCrawled: history.lastCrawled,
        totalChanges: history.changes.length,
      });
    }
  }

  return summaries;
}
