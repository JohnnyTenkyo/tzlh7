import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMarketCapFromCache,
  setMarketCapInCache,
  getMultipleMarketCapsFromCache,
  setMultipleMarketCapsInCache,
  clearMarketCapCache,
  clearAllMarketCapCache,
  getMarketCapCacheStats,
  getSymbolsNeedingUpdate,
} from "./marketCapCache";

describe("Market Cap Cache System", () => {
  beforeEach(() => {
    clearAllMarketCapCache();
  });

  afterEach(() => {
    clearAllMarketCapCache();
  });

  describe("Single Market Cap Operations", () => {
    it("should set and get market cap from cache", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      const result = getMarketCapFromCache("AAPL");
      expect(result).toBeDefined();
      expect(result?.symbol).toBe("AAPL");
      expect(result?.marketCap).toBe(3000);
      expect(result?.source).toBe("finnhub");
    });

    it("should return null for non-existent symbol", () => {
      const result = getMarketCapFromCache("NONEXISTENT");
      expect(result).toBeNull();
    });

    it("should set null market cap for failed fetches", () => {
      setMarketCapInCache("FAILED", null, "finnhub");
      const result = getMarketCapFromCache("FAILED");
      expect(result).toBeDefined();
      expect(result?.marketCap).toBeNull();
    });

    it("should clear individual cache entry", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      clearMarketCapCache("AAPL");
      const result = getMarketCapFromCache("AAPL");
      expect(result).toBeNull();
    });
  });

  describe("Multiple Market Cap Operations", () => {
    it("should set and get multiple market caps", () => {
      const data = {
        AAPL: 3000,
        MSFT: 2500,
        GOOGL: 1800,
      };
      setMultipleMarketCapsInCache(data, "finnhub");

      const result = getMultipleMarketCapsFromCache(["AAPL", "MSFT", "GOOGL"]);
      expect(result.AAPL?.marketCap).toBe(3000);
      expect(result.MSFT?.marketCap).toBe(2500);
      expect(result.GOOGL?.marketCap).toBe(1800);
    });

    it("should handle partial cache hits", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      const result = getMultipleMarketCapsFromCache(["AAPL", "MSFT", "GOOGL"]);
      expect(result.AAPL).toBeDefined();
      expect(result.MSFT).toBeNull();
      expect(result.GOOGL).toBeNull();
    });

    it("should return null for non-existent symbols", () => {
      const result = getMultipleMarketCapsFromCache(["NONEXISTENT1", "NONEXISTENT2"]);
      expect(result.NONEXISTENT1).toBeNull();
      expect(result.NONEXISTENT2).toBeNull();
    });
  });

  describe("Cache Statistics", () => {
    it("should return correct cache stats", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      setMarketCapInCache("MSFT", 2500, "finnhub");
      const stats = getMarketCapCacheStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.cachedSymbols).toContain("AAPL");
      expect(stats.cachedSymbols).toContain("MSFT");
    });

    it("should return empty stats when cache is cleared", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      clearAllMarketCapCache();
      const stats = getMarketCapCacheStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.cachedSymbols.length).toBe(0);
    });
  });

  describe("Cache Expiration", () => {
    it("should identify symbols needing update", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      const needsUpdate = getSymbolsNeedingUpdate(["AAPL", "MSFT", "GOOGL"]);
      expect(needsUpdate).toContain("MSFT");
      expect(needsUpdate).toContain("GOOGL");
      expect(needsUpdate).not.toContain("AAPL");
    });

    it("should identify all symbols as needing update when cache is empty", () => {
      const needsUpdate = getSymbolsNeedingUpdate(["AAPL", "MSFT", "GOOGL"]);
      expect(needsUpdate).toHaveLength(3);
      expect(needsUpdate).toContain("AAPL");
      expect(needsUpdate).toContain("MSFT");
      expect(needsUpdate).toContain("GOOGL");
    });
  });

  describe("Cache Clearing", () => {
    it("should clear all cache entries", () => {
      setMarketCapInCache("AAPL", 3000, "finnhub");
      setMarketCapInCache("MSFT", 2500, "finnhub");
      clearAllMarketCapCache();
      expect(getMarketCapFromCache("AAPL")).toBeNull();
      expect(getMarketCapFromCache("MSFT")).toBeNull();
    });

    it("should handle clearing non-existent entries", () => {
      expect(() => clearMarketCapCache("NONEXISTENT")).not.toThrow();
    });
  });

  describe("Data Integrity", () => {
    it("should preserve all market cap data fields", () => {
      setMarketCapInCache("AAPL", 3000, "alphavantage");
      const result = getMarketCapFromCache("AAPL");
      expect(result?.symbol).toBe("AAPL");
      expect(result?.marketCap).toBe(3000);
      expect(result?.currency).toBe("USD");
      expect(result?.source).toBe("alphavantage");
      expect(result?.lastUpdated).toBeDefined();
      expect(result?.lastUpdated).toBeGreaterThan(0);
    });

    it("should handle zero market cap", () => {
      setMarketCapInCache("PENNY", 0, "finnhub");
      const result = getMarketCapFromCache("PENNY");
      expect(result?.marketCap).toBe(0);
    });

    it("should handle very large market cap values", () => {
      const largeValue = 1e12; // 1 trillion
      setMarketCapInCache("MEGA", largeValue, "finnhub");
      const result = getMarketCapFromCache("MEGA");
      expect(result?.marketCap).toBe(largeValue);
    });
  });
});
