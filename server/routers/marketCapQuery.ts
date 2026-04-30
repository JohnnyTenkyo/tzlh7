import { publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { updateMarketCapBatch } from "../marketCapUpdater";
import {
  getMarketCapFromCache,
  getMultipleMarketCapsFromCache,
  setMarketCapInCache,
  setMultipleMarketCapsInCache,
  getSymbolsNeedingUpdate,
} from "../marketCapCache";

/**
 * Market cap query procedures
 * Provides real-time market cap data with in-memory caching
 */
export const marketCapQueryRouter = {
  /**
   * Get market cap for a single stock
   * Returns cached value if available, otherwise fetches from Finnhub API
   */
  getMarketCap: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      const { symbol } = input;

      // Try to get from cache first
      const cached = getMarketCapFromCache(symbol);
      if (cached) {
        return {
          symbol,
          marketCap: cached.marketCap,
          currency: cached.currency,
          source: cached.source,
          fromCache: true,
        };
      }

      // Fetch from Finnhub API
      try {
        const result = await updateMarketCapBatch([symbol], "finnhub");

        if (result.successCount > 0) {
          const cached = getMarketCapFromCache(symbol);
          if (cached) {
            return {
              symbol,
              marketCap: cached.marketCap,
              currency: cached.currency,
              source: cached.source,
              fromCache: false,
            };
          }
        }

        return {
          symbol,
          marketCap: null,
          currency: "USD",
          source: "finnhub",
          fromCache: false,
          error: "Failed to fetch market cap",
        };
      } catch (err: any) {
        console.error(`[MarketCapQuery] Error fetching market cap for ${symbol}:`, err.message);
        return {
          symbol,
          marketCap: null,
          currency: "USD",
          source: "finnhub",
          fromCache: false,
          error: err.message,
        };
      }
    }),

  /**
   * Get market caps for multiple stocks
   * Returns cached values where available, fetches missing ones from Finnhub API
   */
  getMultipleMarketCaps: publicProcedure
    .input(z.object({ symbols: z.array(z.string()) }))
    .query(async ({ input }) => {
      const { symbols } = input;

      // Get cached values
      const cached = getMultipleMarketCapsFromCache(symbols);

      // Find symbols that need updating
      const symbolsNeedingUpdate = getSymbolsNeedingUpdate(symbols);

      if (symbolsNeedingUpdate.length > 0) {
        try {
          // Fetch in batches to avoid rate limiting
          const batchSize = 50;
          for (let i = 0; i < symbolsNeedingUpdate.length; i += batchSize) {
            const batch = symbolsNeedingUpdate.slice(i, i + batchSize);
            await updateMarketCapBatch(batch, "finnhub");

            // Add small delay between batches
            if (i + batchSize < symbolsNeedingUpdate.length) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        } catch (err: any) {
          console.error("[MarketCapQuery] Error fetching market caps:", err.message);
        }
      }

      // Return all market caps (cached + newly fetched)
      const result: Record<string, any> = {};
      for (const symbol of symbols) {
        const entry = getMarketCapFromCache(symbol) || cached[symbol];
        result[symbol] = {
          symbol,
          marketCap: entry?.marketCap || null,
          currency: entry?.currency || "USD",
          source: entry?.source || "finnhub",
          fromCache: !!entry,
        };
      }

      return result;
    }),

  /**
   * Prefetch market caps for a list of symbols
   * Useful for preloading data before displaying stock pool
   */
  prefetchMarketCaps: publicProcedure
    .input(z.object({ symbols: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const { symbols } = input;

      // Find symbols that need updating
      const symbolsNeedingUpdate = getSymbolsNeedingUpdate(symbols);

      if (symbolsNeedingUpdate.length === 0) {
        return {
          message: "All market caps are already cached",
          prefetchedCount: 0,
        };
      }

      try {
        // Fetch in batches
        const batchSize = 50;
        let totalFetched = 0;

        for (let i = 0; i < symbolsNeedingUpdate.length; i += batchSize) {
          const batch = symbolsNeedingUpdate.slice(i, i + batchSize);
          const result = await updateMarketCapBatch(batch, "finnhub");
          totalFetched += result.successCount;

          // Add delay between batches
          if (i + batchSize < symbolsNeedingUpdate.length) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        return {
          message: `Prefetched ${totalFetched} market caps`,
          prefetchedCount: totalFetched,
          failedCount: symbolsNeedingUpdate.length - totalFetched,
        };
      } catch (err: any) {
        console.error("[MarketCapQuery] Error prefetching market caps:", err.message);
        return {
          message: `Error prefetching market caps: ${err.message}`,
          prefetchedCount: 0,
          error: err.message,
        };
      }
    }),

  /**
   * Get cache statistics
   */
  getCacheStats: publicProcedure.query(async () => {
    const { getMarketCapCacheStats } = await import("../marketCapCache");
    return getMarketCapCacheStats();
  }),
};
