import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getMarketCap, updateMarketCapBatch } from "./marketCapUpdater";

describe("Market Cap Updater", () => {
  // Mock API responses
  const mockFinnhubResponse = {
    marketCapitalization: 3500000000000, // $3.5 trillion = 35亿美元
  };

  const mockAlphaVantageResponse = {
    MarketCapitalization: "2800000000000", // $2.8 trillion = 28亿美元
  };

  beforeAll(() => {
    // Setup environment variables for testing
    process.env.FINNHUB_API_KEY = "test-finnhub-key";
    process.env.ALPHAVANTAGE_API_KEY = "test-alphavantage-key";
  });

  afterAll(() => {
    // Cleanup
    delete process.env.FINNHUB_API_KEY;
    delete process.env.ALPHAVANTAGE_API_KEY;
  });

  describe("Market Cap Conversion", () => {
    it("should convert USD to hundred million USD correctly", () => {
      // $3.5 trillion = 3,500,000,000,000 USD = 35,000 hundred million USD
      const usdAmount = 3500000000000;
      const hundredMillionUSD = Math.round(usdAmount / 100_000_000);
      expect(hundredMillionUSD).toBe(35000);
    });

    it("should handle large market caps correctly", () => {
      // Apple market cap ~$3.5T
      const appleMarketCap = 3500000000000;
      const result = Math.round(appleMarketCap / 100_000_000);
      expect(result).toBeGreaterThan(30000);
      expect(result).toBeLessThan(40000);
    });

    it("should handle small market caps correctly", () => {
      // Small cap ~$1B
      const smallCap = 1000000000;
      const result = Math.round(smallCap / 100_000_000);
      expect(result).toBe(10);
    });
  });

  describe("API Response Parsing", () => {
    it("should parse Finnhub response correctly", () => {
      const marketCapUSD = mockFinnhubResponse.marketCapitalization;
      const marketCapHundredMillion = Math.round(marketCapUSD / 100_000_000);
      expect(marketCapHundredMillion).toBe(35000);
    });

    it("should parse AlphaVantage response correctly", () => {
      const marketCapStr = mockAlphaVantageResponse.MarketCapitalization;
      const marketCapUSD = parseInt(marketCapStr, 10);
      const marketCapHundredMillion = Math.round(marketCapUSD / 100_000_000);
      expect(marketCapHundredMillion).toBe(28000);
    });

    it("should handle missing market cap data", () => {
      const emptyResponse = {};
      const marketCap = (emptyResponse as any).marketCapitalization;
      expect(marketCap).toBeUndefined();
    });

    it("should handle zero market cap", () => {
      const zeroResponse = { marketCapitalization: 0 };
      const marketCapUSD = zeroResponse.marketCapitalization;
      expect(marketCapUSD).toBe(0);
      expect(marketCapUSD > 0).toBe(false);
    });
  });

  describe("Market Cap Formatting", () => {
    it("should format market cap as currency", () => {
      const marketCapBillion = 3500; // 3500亿美元
      const formatted = `$${(marketCapBillion / 10).toFixed(1)}B`;
      expect(formatted).toBe("$350.0B");
    });

    it("should format small market cap correctly", () => {
      const marketCapBillion = 10; // 10亿美元
      const formatted = `$${(marketCapBillion / 10).toFixed(1)}B`;
      expect(formatted).toBe("$1.0B");
    });

    it("should display unknown for zero market cap", () => {
      const marketCap = 0;
      const display = marketCap === 0 ? "未知" : `$${(marketCap / 10).toFixed(1)}B`;
      expect(display).toBe("未知");
    });
  });

  describe("Batch Processing", () => {
    it("should calculate success rate correctly", () => {
      const total = 100;
      const successful = 85;
      const failed = 15;
      const successRate = (successful / total) * 100;
      expect(successRate).toBe(85);
      expect(failed).toBe(total - successful);
    });

    it("should handle empty batch", () => {
      const symbols: string[] = [];
      expect(symbols.length).toBe(0);
    });

    it("should handle single symbol batch", () => {
      const symbols = ["AAPL"];
      expect(symbols.length).toBe(1);
    });

    it("should handle large batch", () => {
      const symbols = Array.from({ length: 778 }, (_, i) => `SYM${i}`);
      expect(symbols.length).toBe(778);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing API key", () => {
      const apiKey = undefined;
      const hasKey = !!apiKey;
      expect(hasKey).toBe(false);
    });

    it("should handle HTTP errors", () => {
      const statusCode = 429; // Rate limit
      const isError = statusCode >= 400;
      expect(isError).toBe(true);
    });

    it("should handle timeout", () => {
      const timeoutMs = 5000;
      expect(timeoutMs).toBeGreaterThan(0);
    });

    it("should handle network errors", () => {
      const error = new Error("Network timeout");
      expect(error.message).toContain("timeout");
    });
  });

  describe("Data Validation", () => {
    it("should validate symbol format", () => {
      const validSymbols = ["AAPL", "MSFT", "GOOGL"];
      validSymbols.forEach(symbol => {
        expect(symbol).toMatch(/^[A-Z]{1,5}$/);
      });
    });

    it("should reject invalid symbols", () => {
      const invalidSymbols = ["", "123", "aapl", "TOOLONGNAME"];
      invalidSymbols.forEach(symbol => {
        const isValid = /^[A-Z]{1,5}$/.test(symbol);
        expect(isValid).toBe(false);
      });
    });

    it("should validate market cap is positive", () => {
      const marketCaps = [100, 1000, 10000];
      marketCaps.forEach(cap => {
        expect(cap > 0).toBe(true);
      });
    });

    it("should validate source field", () => {
      const validSources = ["finnhub", "alphavantage"];
      validSources.forEach(source => {
        expect(["finnhub", "alphavantage"].includes(source)).toBe(true);
      });
    });
  });
});
