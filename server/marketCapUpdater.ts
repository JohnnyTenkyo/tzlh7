import { getDb } from "./db";
import { marketCapCache, marketCapUpdateLog } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY;

interface MarketCapResult {
  symbol: string;
  marketCap: number | null;
  source: string;
  success: boolean;
  error?: string;
}

/**
 * 从 Finnhub 获取单个股票的市值
 * API: /company-profile2 - 返回 marketCapitalization (单位: USD)
 */
async function getMarketCapFromFinnhub(symbol: string): Promise<MarketCapResult> {
  if (!FINNHUB_API_KEY) {
    return { symbol, marketCap: null, source: "finnhub", success: false, error: "No API key" };
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return { symbol, marketCap: null, source: "finnhub", success: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json() as { marketCapitalization?: number };
    const marketCapUSD = data.marketCapitalization;
    
    if (marketCapUSD && marketCapUSD > 0) {
      // 转换为亿美元 (divide by 100,000,000)
      const marketCapHundredMillion = Math.round(marketCapUSD / 100_000_000);
      return { symbol, marketCap: marketCapHundredMillion, source: "finnhub", success: true };
    }
    
    return { symbol, marketCap: null, source: "finnhub", success: false, error: "No market cap data" };
  } catch (error) {
    return { symbol, marketCap: null, source: "finnhub", success: false, error: String(error) };
  }
}

/**
 * 从 AlphaVantage 获取单个股票的市值
 * API: OVERVIEW - 返回 MarketCapitalization (单位: USD)
 */
async function getMarketCapFromAlphaVantage(symbol: string): Promise<MarketCapResult> {
  if (!ALPHAVANTAGE_API_KEY) {
    return { symbol, marketCap: null, source: "alphavantage", success: false, error: "No API key" };
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHAVANTAGE_API_KEY}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return { symbol, marketCap: null, source: "alphavantage", success: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json() as { MarketCapitalization?: string };
    const marketCapStr = data.MarketCapitalization;
    
    if (marketCapStr) {
      const marketCapUSD = parseInt(marketCapStr, 10);
      if (marketCapUSD > 0) {
        // 转换为亿美元
        const marketCapHundredMillion = Math.round(marketCapUSD / 100_000_000);
        return { symbol, marketCap: marketCapHundredMillion, source: "alphavantage", success: true };
      }
    }
    
    return { symbol, marketCap: null, source: "alphavantage", success: false, error: "No market cap data" };
  } catch (error) {
    return { symbol, marketCap: null, source: "alphavantage", success: false, error: String(error) };
  }
}

/**
 * 批量更新市值数据
 * 优先使用 Finnhub，失败则尝试 AlphaVantage
 */
export async function updateMarketCapBatch(symbols: string[], preferredSource: "finnhub" | "alphavantage" = "finnhub") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const results: MarketCapResult[] = [];
  const failedSymbols: string[] = [];
  let successCount = 0;
  
  console.log(`[MarketCapUpdater] Starting batch update for ${symbols.length} symbols`);
  
  // 批量获取市值，每个请求间隔 200ms 避免 API 限流
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    
    // 优先尝试 Finnhub
    let result = await getMarketCapFromFinnhub(symbol);
    
    // 如果 Finnhub 失败，尝试 AlphaVantage
    if (!result.success && preferredSource === "finnhub") {
      result = await getMarketCapFromAlphaVantage(symbol);
    }
    
    results.push(result);
    
    if (result.success && result.marketCap !== null) {
      successCount++;
      // 保存到数据库
      await db
        .insert(marketCapCache)
        .values({
          symbol: result.symbol,
          marketCap: result.marketCap,
          source: result.source,
        })
        .onDuplicateKeyUpdate({
          set: {
            marketCap: result.marketCap,
            source: result.source,
            lastUpdated: new Date(),
          },
        });
    } else {
      failedSymbols.push(symbol);
    }
    
    // 延迟 200ms 避免 API 限流
    if (i < symbols.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  // 记录更新日志
  const updateDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  await db.insert(marketCapUpdateLog).values({
    updateDate,
    totalSymbols: symbols.length,
    successCount,
    failureCount: failedSymbols.length,
    source: preferredSource,
    errorLog: failedSymbols.length > 0 ? JSON.stringify(failedSymbols) : null,
  });
  
  console.log(`[MarketCapUpdater] Batch update completed: ${successCount}/${symbols.length} successful`);
  
  return {
    successCount,
    failureCount: failedSymbols.length,
    failedSymbols,
    results,
  };
}

/**
 * 获取单个股票的市值（从缓存或 API）
 */
export async function getMarketCap(symbol: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  
  // 先从缓存查询
  const cached = await db
    .select()
    .from(marketCapCache)
    .where(eq(marketCapCache.symbol, symbol))
    .limit(1);
  
  if (cached.length > 0 && cached[0].marketCap) {
    return cached[0].marketCap;
  }
  
  // 缓存未命中，尝试从 API 获取
  const result = await getMarketCapFromFinnhub(symbol);
  if (result.success && result.marketCap) {
    // 保存到缓存
    await db
      .insert(marketCapCache)
      .values({
        symbol,
        marketCap: result.marketCap,
        source: "finnhub",
      })
      .onDuplicateKeyUpdate({
        set: {
          marketCap: result.marketCap,
          source: "finnhub",
          lastUpdated: new Date(),
        },
      });
    return result.marketCap;
  }
  
  // Finnhub 失败，尝试 AlphaVantage
  const result2 = await getMarketCapFromAlphaVantage(symbol);
  if (result2.success && result2.marketCap) {
    await db
      .insert(marketCapCache)
      .values({
        symbol,
        marketCap: result2.marketCap,
        source: "alphavantage",
      })
      .onDuplicateKeyUpdate({
        set: {
          marketCap: result2.marketCap,
          source: "alphavantage",
          lastUpdated: new Date(),
        },
      });
    return result2.marketCap;
  }
  
  return null;
}

/**
 * 获取最近的更新日志
 */
export async function getUpdateLog(days: number = 7) {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().split("T")[0];
  
  const { gte } = require("drizzle-orm");
  return await db
    .select()
    .from(marketCapUpdateLog)
    .where(gte(marketCapUpdateLog.updateDate, cutoffDateStr))
    .orderBy(marketCapUpdateLog.updateDate);
}
