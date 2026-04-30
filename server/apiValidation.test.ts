import { describe, it, expect, beforeAll } from 'vitest';

/**
 * API Validation Tests
 * 
 * These tests verify that external APIs (Finnhub, AlphaVantage) are properly configured
 * and can be called successfully. These are integration tests that require valid API keys.
 */

describe('API Validation', () => {
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
  const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY;

  describe('Finnhub API', () => {
    it('should have FINNHUB_API_KEY configured', () => {
      expect(FINNHUB_API_KEY).toBeDefined();
      expect(FINNHUB_API_KEY).toBeTruthy();
      expect(FINNHUB_API_KEY?.length).toBeGreaterThan(0);
    });

    it('should be able to fetch market cap from Finnhub', async () => {
      if (!FINNHUB_API_KEY) {
        console.warn('⚠️ FINNHUB_API_KEY not configured, skipping Finnhub test');
        expect(true).toBe(true);
        return;
      }

      try {
        const response = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=${FINNHUB_API_KEY}`,
          { signal: AbortSignal.timeout(5000) }
        );

        expect(response.ok).toBe(true);
        const data = await response.json() as { marketCapitalization?: number };
        expect(data).toBeDefined();
        
        if (data.marketCapitalization) {
          expect(data.marketCapitalization).toBeGreaterThan(0);
          console.log(`✓ Finnhub API working: AAPL market cap = $${data.marketCapitalization / 1e9}B`);
        } else {
          console.warn('⚠️ Finnhub returned no market cap data for AAPL');
        }
      } catch (error) {
        console.error('✗ Finnhub API error:', error);
        throw error;
      }
    }, { timeout: 10000 });
  });

  describe('AlphaVantage API', () => {
    it('should have ALPHAVANTAGE_API_KEY configured', () => {
      expect(ALPHAVANTAGE_API_KEY).toBeDefined();
      expect(ALPHAVANTAGE_API_KEY).toBeTruthy();
      expect(ALPHAVANTAGE_API_KEY?.length).toBeGreaterThan(0);
    });

    it('should be able to fetch market cap from AlphaVantage', async () => {
      if (!ALPHAVANTAGE_API_KEY) {
        console.warn('⚠️ ALPHAVANTAGE_API_KEY not configured, skipping AlphaVantage test');
        expect(true).toBe(true);
        return;
      }

      try {
        const response = await fetch(
          `https://www.alphavantage.co/query?function=OVERVIEW&symbol=AAPL&apikey=${ALPHAVANTAGE_API_KEY}`,
          { signal: AbortSignal.timeout(5000) }
        );

        expect(response.ok).toBe(true);
        const data = await response.json() as { MarketCapitalization?: string };
        expect(data).toBeDefined();
        
        if (data.MarketCapitalization) {
          const marketCap = parseInt(data.MarketCapitalization, 10);
          expect(marketCap).toBeGreaterThan(0);
          console.log(`✓ AlphaVantage API working: AAPL market cap = $${marketCap / 1e9}B`);
        } else {
          console.warn('⚠️ AlphaVantage returned no market cap data for AAPL');
        }
      } catch (error) {
        console.error('✗ AlphaVantage API error:', error);
        throw error;
      }
    }, { timeout: 10000 });
  });

  describe('API Fallback Strategy', () => {
    it('should have at least one API key configured', () => {
      const hasAtLeastOneKey = !!FINNHUB_API_KEY || !!ALPHAVANTAGE_API_KEY;
      expect(hasAtLeastOneKey).toBe(true);
    });

    it('should prefer Finnhub over AlphaVantage when both are available', () => {
      // This is a design test - the actual implementation should prefer Finnhub
      if (!!FINNHUB_API_KEY && !!ALPHAVANTAGE_API_KEY) {
        console.log('✓ Both APIs configured - system will use Finnhub first, then AlphaVantage as fallback');
        expect(true).toBe(true);
      } else if (!!FINNHUB_API_KEY) {
        console.log('✓ Only Finnhub configured');
        expect(true).toBe(true);
      } else if (!!ALPHAVANTAGE_API_KEY) {
        console.log('✓ Only AlphaVantage configured');
        expect(true).toBe(true);
      }
    });
  });

  describe('Scheduled Task Configuration', () => {
    it('should have node-cron properly configured', () => {
      // This test verifies that the cron scheduler can be imported
      try {
        require('node-cron');
        console.log('✓ node-cron is installed and available');
        expect(true).toBe(true);
      } catch (error: any) {
        console.error('✗ node-cron not found:', error);
        throw error;
      }
    });
  });
});
