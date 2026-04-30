/**
 * In-memory market cap cache system
 * Stores market cap data fetched from Finnhub API
 * No database modifications - all data stored in memory
 */

interface MarketCapEntry {
  symbol: string;
  marketCap: number | null; // in billions USD
  currency: string;
  source: string;
  lastUpdated: number; // timestamp
}

// In-memory cache
const marketCapCache = new Map<string, MarketCapEntry>();

// Cache TTL: 24 hours (in milliseconds)
const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Get market cap from cache
 */
export function getMarketCapFromCache(symbol: string): MarketCapEntry | null {
  const entry = marketCapCache.get(symbol);

  if (!entry) {
    return null;
  }

  // Check if cache is expired
  if (Date.now() - entry.lastUpdated > CACHE_TTL) {
    marketCapCache.delete(symbol);
    return null;
  }

  return entry;
}

/**
 * Set market cap in cache
 */
export function setMarketCapInCache(
  symbol: string,
  marketCap: number | null,
  source: string = "finnhub"
): void {
  marketCapCache.set(symbol, {
    symbol,
    marketCap,
    currency: "USD",
    source,
    lastUpdated: Date.now(),
  });
}

/**
 * Get multiple market caps from cache
 */
export function getMultipleMarketCapsFromCache(symbols: string[]): Record<string, MarketCapEntry | null> {
  const result: Record<string, MarketCapEntry | null> = {};

  for (const symbol of symbols) {
    result[symbol] = getMarketCapFromCache(symbol);
  }

  return result;
}

/**
 * Set multiple market caps in cache
 */
export function setMultipleMarketCapsInCache(
  data: Record<string, number | null>,
  source: string = "finnhub"
): void {
  for (const [symbol, marketCap] of Object.entries(data)) {
    setMarketCapInCache(symbol, marketCap, source);
  }
}

/**
 * Clear cache for a symbol
 */
export function clearMarketCapCache(symbol: string): void {
  marketCapCache.delete(symbol);
}

/**
 * Clear all cache
 */
export function clearAllMarketCapCache(): void {
  marketCapCache.clear();
}

/**
 * Get cache statistics
 */
export function getMarketCapCacheStats(): {
  totalEntries: number;
  cachedSymbols: string[];
} {
  return {
    totalEntries: marketCapCache.size,
    cachedSymbols: Array.from(marketCapCache.keys()),
  };
}

/**
 * Get symbols that need update (expired or missing)
 */
export function getSymbolsNeedingUpdate(symbols: string[]): string[] {
  return symbols.filter((symbol) => {
    const entry = marketCapCache.get(symbol);
    if (!entry) return true;
    return Date.now() - entry.lastUpdated > CACHE_TTL;
  });
}
