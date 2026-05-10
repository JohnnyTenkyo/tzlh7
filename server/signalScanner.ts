/**
 * Signal Scanner Engine
 * Scans stock pool for buy/sell signals across multiple strategies
 */
import { getCandlesWithCache } from "./cacheManager";
import {
  calculateMACD, calculateLadder, calculateCDSignals, calculateRSI,
  calculateBollingerBands, calculateATR,
} from "./indicators";
import { STOCK_POOL, filterStocks, type StockSector, type MarketCapTier } from "@shared/stockPool";
import { getDb } from "./db";
import { scanResults } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export type SignalType = "buy" | "sell" | "hold";
export type StrategySignalType = "standard" | "aggressive" | "ladder_cd_combo" | "mean_reversion" | "macd_volume" | "bollinger_squeeze" | "vamr" | "rsi_reversal";

export interface StockSignal {
  symbol: string;
  name: string;
  sectors: string[];
  marketCap: number;
  strategy: StrategySignalType;
  signalType: SignalType;
  score: number; // 0-100
  rsi: number;
  macdHistogram: number;
  ladderGap: number; // blueUp - yellowUp gap
  bbPosition: number; // 0-1 position in BB band
  volumeRatio: number; // current volume / 20d avg volume
  signals: string[]; // human-readable signal descriptions
  trend: "up" | "down" | "neutral";
  price: number;
  priceChange1d: number; // 1-day price change %
}

export interface ScanOptions {
  strategies?: StrategySignalType[];
  sectors?: StockSector[];
  marketCapTiers?: MarketCapTier[];
  minScore?: number;
  signalType?: SignalType;
  limit?: number;
  useCache?: boolean; // use DB cached results if available
  excludeSymbols?: Set<string>; // symbols to exclude (e.g., delisted or renamed)
}

function getTodayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Analyze a single stock across a strategy and return signal
 */
export function analyzeStock(
  symbol: string,
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  strategy: StrategySignalType
): Omit<StockSignal, "symbol" | "name" | "sectors" | "marketCap"> {
  if (candles.length < 30) {
    return { strategy, signalType: "hold", score: 0, rsi: 50, macdHistogram: 0, ladderGap: 0, bbPosition: 0.5, volumeRatio: 1, signals: ["数据不足"], trend: "neutral", price: 0, priceChange1d: 0 };
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const price = latest.close;
  const priceChange1d = prev ? (latest.close - prev.close) / prev.close : 0;

  // Calculate indicators
  const rsiArr = calculateRSI(candles, 14);
  const rsi = rsiArr[rsiArr.length - 1] || 50;
  const macd = calculateMACD(candles, 12, 26, 9);
  const macdHistogram = macd.histogram[macd.histogram.length - 1] || 0;
  const macdDiff = macd.diff[macd.diff.length - 1] || 0;
  const macdDea = macd.dea[macd.dea.length - 1] || 0;
  const ladder = calculateLadder(candles);
  const latestLadder = ladder[ladder.length - 1];
  const ladderGap = latestLadder ? (latestLadder.blueUp - latestLadder.yellowUp) : 0;
  const bb = calculateBollingerBands(candles, 20, 2);
  const bbLen = bb.upper.length;
  const latestBB = bbLen > 0 ? { upper: bb.upper[bbLen - 1], middle: bb.middle[bbLen - 1], lower: bb.lower[bbLen - 1], bandwidth: bb.bandwidth[bbLen - 1] } : null;
  const bbPosition = latestBB ? (price - latestBB.lower) / (latestBB.upper - latestBB.lower || 1) : 0.5;
  const atr = calculateATR(candles, 14);
  const latestATR = atr[atr.length - 1] || 0;

  // Volume ratio
  const avgVol = candles.slice(-21, -1).reduce((a, b) => a + b.volume, 0) / 20;
  const volumeRatio = avgVol > 0 ? latest.volume / avgVol : 1;

  // Trend determination
  const ema20 = candles.slice(-20).reduce((a, b) => a + b.close, 0) / 20;
  const ema50 = candles.slice(-50).reduce((a, b) => a + b.close, 0) / Math.min(50, candles.length);
  const trend: "up" | "down" | "neutral" = price > ema20 && ema20 > ema50 ? "up" : price < ema20 && ema20 < ema50 ? "down" : "neutral";

  const signals: string[] = [];
  let score = 0;
  let signalType: SignalType = "hold";

  // CD signals
  const cdSignals = calculateCDSignals(candles);
  const recentCDBuy = cdSignals.filter(s => s.type === "buy" && s.time >= candles[candles.length - 5].time);
  const recentCDSell = cdSignals.filter(s => s.type === "sell" && s.time >= candles[candles.length - 5].time);

  switch (strategy) {
    case "standard": {
      // CD buy signal + ladder confirmation
      if (recentCDBuy.length > 0) {
        score += 40;
        signals.push(`CD买入信号: ${recentCDBuy[0].label}`);
      }
      if (latestLadder && price > latestLadder.blueMid) {
        score += 20;
        signals.push("价格在蓝梯中轨上方");
      }
      if (macdHistogram > 0 && macdDiff > macdDea) {
        score += 20;
        signals.push("MACD金叉");
      }
      if (volumeRatio > 1.3) {
        score += 10;
        signals.push(`量能放大${volumeRatio.toFixed(1)}x`);
      }
      if (rsi > 40 && rsi < 70) {
        score += 10;
        signals.push(`RSI健康区间(${rsi.toFixed(0)})`);
      }
      if (recentCDSell.length > 0) {
        score -= 30;
        signals.push(`CD卖出信号: ${recentCDSell[0].label}`);
      }
      if (score >= 50) signalType = "buy";
      else if (score <= -10) signalType = "sell";
      break;
    }
    case "aggressive": {
      // Aggressive: CD buy + above blue ladder
      if (recentCDBuy.length > 0) { score += 50; signals.push(`CD强买信号`); }
      if (latestLadder && price > latestLadder.blueUp) { score += 30; signals.push("突破蓝梯上轨"); }
      if (volumeRatio > 1.5) { score += 20; signals.push(`强量放大${volumeRatio.toFixed(1)}x`); }
      if (recentCDSell.length > 0) { score -= 40; signals.push("CD卖出"); }
      if (score >= 50) signalType = "buy";
      else if (score <= -20) signalType = "sell";
      break;
    }
    case "ladder_cd_combo": {
      // Multi-confirmation
      if (recentCDBuy.length > 0) { score += 30; signals.push("CD买入"); }
      if (latestLadder && latestLadder.blueUp > latestLadder.yellowUp) { score += 25; signals.push("蓝梯在黄梯上方"); }
      if (latestLadder && price > latestLadder.blueMid) { score += 20; signals.push("价格在蓝梯中轨上"); }
      if (macdHistogram > 0) { score += 15; signals.push("MACD柱体为正"); }
      if (volumeRatio > 1.2) { score += 10; signals.push(`量能确认${volumeRatio.toFixed(1)}x`); }
      if (score >= 60) signalType = "buy";
      else if (recentCDSell.length > 0 && score < 20) signalType = "sell";
      break;
    }
    case "mean_reversion": {
      // RSI oversold + BB lower band
      if (rsi < 35) { score += 40; signals.push(`RSI超卖(${rsi.toFixed(0)})`); }
      else if (rsi < 45) { score += 20; signals.push(`RSI偏低(${rsi.toFixed(0)})`); }
      if (bbPosition < 0.2) { score += 30; signals.push("接近布林下轨"); }
      else if (bbPosition < 0.35) { score += 15; signals.push("布林带下方区域"); }
      if (latestLadder && price > latestLadder.yellowDn) { score += 20; signals.push("黄梯下轨支撑"); }
      if (rsi > 65) { score -= 20; signals.push(`RSI超买(${rsi.toFixed(0)})`); }
      if (bbPosition > 0.8) { score -= 15; signals.push("接近布林上轨"); }
      if (score >= 50) signalType = "buy";
      else if (score <= -15) signalType = "sell";
      break;
    }
    case "macd_volume": {
      // MACD golden cross + volume spike
      if (macdDiff > macdDea && macdHistogram > 0) { score += 35; signals.push("MACD金叉"); }
      if (volumeRatio > 1.5) { score += 35; signals.push(`量能放大${volumeRatio.toFixed(1)}x`); }
      if (latestLadder && price > latestLadder.blueUp) { score += 20; signals.push("价格在蓝梯上方"); }
      if (trend === "up") { score += 10; signals.push("上升趋势"); }
      if (macdDiff < macdDea) { score -= 25; signals.push("MACD死叉"); }
      if (score >= 50) signalType = "buy";
      else if (score <= -15) signalType = "sell";
      break;
    }
    case "bollinger_squeeze": {
      // BB squeeze breakout
      const bbWidth = latestBB ? latestBB.bandwidth : 0.1;
      if (bbWidth < 0.06) { score += 30; signals.push(`布林带收缩(带宽${(bbWidth * 100).toFixed(1)}%)`); }
      if (price > (latestBB?.middle || price)) { score += 25; signals.push("价格突破布林中轨"); }
      if (recentCDBuy.length > 0) { score += 25; signals.push("CD确认方向"); }
      if (volumeRatio > 1.2) { score += 20; signals.push(`量能确认`); }
      if (score >= 50) signalType = "buy";
      else if (bbPosition > 0.9 && recentCDSell.length > 0) signalType = "sell";
      break;
    }
    case "vamr": {
      // RSI(4) oversold + ATR filter
      const rsi4 = calculateRSI(candles, 4);
      const rsi4Val = rsi4[rsi4.length - 1] || 50;
      if (rsi4Val < 30) { score += 50; signals.push(`RSI(4)超卖(${rsi4Val.toFixed(0)})`); }
      else if (rsi4Val < 40) { score += 25; signals.push(`RSI(4)偏低(${rsi4Val.toFixed(0)})`); }
      if (latestATR > 0 && price > (latestLadder?.yellowDn || 0)) { score += 25; signals.push("ATR波动率过滤通过"); }
      if (trend === "up") { score += 15; signals.push("上升趋势"); }
      if (score >= 50) signalType = "buy";
      else if (rsi4Val > 75) signalType = "sell";
      break;
    }
    case "rsi_reversal": {
      // RSI reversal from oversold
      const rsiPrev = rsiArr[rsiArr.length - 2] || 50;
      if (rsi > 35 && rsiPrev <= 35) { score += 60; signals.push(`RSI从超卖反转(${rsiPrev.toFixed(0)}→${rsi.toFixed(0)})`); }
      else if (rsi < 40) { score += 30; signals.push(`RSI超卖区域(${rsi.toFixed(0)})`); }
      if (macdHistogram > 0) { score += 20; signals.push("MACD柱体转正"); }
      if (volumeRatio > 1.2) { score += 10; signals.push("量能确认"); }
      if (rsi > 65) { score -= 30; signals.push(`RSI超买(${rsi.toFixed(0)})`); }
      if (score >= 50) signalType = "buy";
      else if (score <= -20) signalType = "sell";
      break;
    }
  }

  // Normalize score to 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    strategy, signalType, score, rsi, macdHistogram, ladderGap, bbPosition, volumeRatio, signals, trend, price, priceChange1d,
  };
}

/**
 * Scan all stocks in pool for signals
 */
export async function scanStockPool(
  options: ScanOptions = {},
  onProgress?: (done: number, total: number, symbol: string) => void,
  jobId?: number
): Promise<StockSignal[]> {
  const {
    strategies = ["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"],
    sectors,
    marketCapTiers,
    minScore = 0,
    signalType,
    limit = 500,
  } = options;

  // Filter stocks
  let stocks = STOCK_POOL;
  // Exclude delisted or renamed stocks
  if (options.excludeSymbols && options.excludeSymbols.size > 0) {
    stocks = stocks.filter(s => !options.excludeSymbols!.has(s.symbol));
  }
  if (sectors && sectors.length > 0) {
    stocks = stocks.filter(s => s.sectors.some(sec => sectors.includes(sec)));
  }
  if (marketCapTiers && marketCapTiers.length > 0) {
    const { getMarketCapTier } = await import("@shared/stockPool");
    stocks = stocks.filter(s => marketCapTiers.includes(getMarketCapTier(s.marketCap)));
  }

  const endDate = getTodayDate();
  const startDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const results: StockSignal[] = [];
  const CONCURRENT = 5;
  const queue = [...stocks];
  let done = 0;

  while (queue.length > 0) {
    // Check if scan was cancelled
    if (jobId) {
      const globalCancelledJobs = (globalThis as any).__cancelledScanJobs || new Set<number>();
      if (globalCancelledJobs.has(jobId)) {
        console.log(`[Scan] Job ${jobId} cancelled by user`);
        globalCancelledJobs.delete(jobId);
        break;
      }
    }

    const batch = queue.splice(0, CONCURRENT);
    await Promise.all(batch.map(async (stock) => {
      try {
        const candles = await getCandlesWithCache(stock.symbol, "1d", startDate, endDate);
        if (candles.length < 30) return;

        for (const strategy of strategies) {
          const analysis = analyzeStock(stock.symbol, candles, strategy);
          if (analysis.score >= minScore && (!signalType || analysis.signalType === signalType)) {
            results.push({
              symbol: stock.symbol,
              name: stock.name,
              sectors: stock.sectors,
              marketCap: stock.marketCap,
              ...analysis,
            });
          }
        }
      } catch (err) {
        // Skip failed stocks with logging
        if (stock.symbol && process.env.DEBUG_SCAN) {
          console.warn(`[Scan] Failed to analyze ${stock.symbol}:`, err instanceof Error ? err.message : String(err));
        }
      } finally {
        done++;
        onProgress?.(done, stocks.length, stock.symbol);
      }
    }));
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit * strategies.length);
}

/**
 * Get today's top buy signals per strategy from DB cache
 */
export async function getTodayTopSignals(
  strategy?: StrategySignalType,
  limit = 10
): Promise<StockSignal[]> {
  const db = await getDb();
  if (!db) return [];

  const today = getTodayDate();
  let rows = await db.select().from(scanResults)
    .where(
      and(
        eq(scanResults.scanDate, today),
        eq(scanResults.signalType, "buy"),
        ...(strategy ? [eq(scanResults.strategy, strategy)] : [])
      )
    )
    .orderBy(desc(scanResults.score))
    .limit(strategy ? limit : limit * 8);

  // If today has no data, fallback to yesterday
  if (rows.length === 0) {
    const yesterday = getYesterdayDate();
    rows = await db.select().from(scanResults)
      .where(
        and(
          eq(scanResults.scanDate, yesterday),
          eq(scanResults.signalType, "buy"),
          ...(strategy ? [eq(scanResults.strategy, strategy)] : [])
        )
      )
      .orderBy(desc(scanResults.score))
      .limit(strategy ? limit : limit * 8);
  }

  return rows.map(r => {
    const stockInfo = STOCK_POOL.find(s => s.symbol === r.symbol);
    return {
      symbol: r.symbol,
      name: stockInfo?.name || r.symbol,
      sectors: stockInfo?.sectors || [],
      marketCap: stockInfo?.marketCap || 0,
      strategy: r.strategy as StrategySignalType,
      signalType: r.signalType as SignalType,
      score: r.score,
      rsi: parseFloat(r.rsi || "50"),
      macdHistogram: parseFloat(r.macdHistogram || "0"),
      ladderGap: parseFloat(r.ladderGap || "0"),
      bbPosition: parseFloat(r.bbPosition || "0.5"),
      volumeRatio: parseFloat(r.volumeRatio || "1"),
      signals: r.signals ? JSON.parse(r.signals) : [],
      trend: (r.trend || "neutral") as "up" | "down" | "neutral",
      price: 0,
      priceChange1d: 0,
    };
  });
}

/**
 * Save scan results to DB
 */
export async function saveScanResults(signals: StockSignal[]): Promise<void> {
  const db = await getDb();
  if (!db || signals.length === 0) return;

  const today = getTodayDate();
  // Delete today's results first
  await db.delete(scanResults).where(eq(scanResults.scanDate, today));

  // Batch insert
  const BATCH = 100;
  for (let i = 0; i < signals.length; i += BATCH) {
    const batch = signals.slice(i, i + BATCH);
    await db.insert(scanResults).values(
      batch.map(s => ({
        scanDate: today,
        symbol: s.symbol,
        strategy: s.strategy,
        signalType: s.signalType,
        score: s.score,
        rsi: s.rsi.toFixed(2),
        macdHistogram: s.macdHistogram.toFixed(4),
        ladderGap: s.ladderGap.toFixed(4),
        bbPosition: s.bbPosition.toFixed(4),
        volumeRatio: s.volumeRatio.toFixed(4),
        signals: JSON.stringify(s.signals),
        trend: s.trend,
      }))
    );
  }
}
