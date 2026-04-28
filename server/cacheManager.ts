/**
 * Cache Manager v4.9 - Restored fast concurrent architecture
 *
 * Architecture (same as v4.4 but EODHD replaces Alpaca):
 * 1. Incremental update: check existing cache before fetching
 *    - Symbols with newestDate within 2 days → SKIP (already up-to-date)
 *    - Symbols with partial cache → fetch only from newestDate+1 (incremental)
 *    - Symbols with no cache → full historical fetch
 * 2. Phase 1: EODHD 50-concurrent batch (fast, replaces Alpaca)
 * 3. Phase 2: Semaphore-8 concurrent fallback via fetchHistoricalCandles failover chain
 * 4. Phase 3: Retry with reduced concurrency
 * 5. WebSocket real-time progress broadcast
 * 6. notifyOwner on completion
 */
import { getDb } from "./db";
import { historicalCandleCache, cacheMetadata } from "../drizzle/schema";
import {
  fetchEODHDBatchCandles,
  fetchHistoricalCandles,
  type Candle,
  type Timeframe,
} from "./marketData";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import {
  broadcastCacheWarmingProgress,
  broadcastCacheWarmingStart,
  broadcastCacheWarmingComplete,
  broadcastCacheWarmingError,
} from "./_core/websocket";

// ============================================================
// Constants
// ============================================================
const HISTORY_YEARS: Record<string, number> = { "1d": 10, "1h": 5, "15m": 2 };
const CONCURRENCY = 8;           // Semaphore concurrency for fallback phase
const EODHD_BATCH_SIZE = 100;    // EODHD batch group size
const EODHD_CONCURRENCY = 50;    // EODHD concurrent requests within each batch
const SAVE_BATCH_SIZE = 500;     // DB insert batch size
const UP_TO_DATE_DAYS = 2;       // Days threshold for "up-to-date" check

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
function candleDateKey(c: Candle, timeframe: string): string {
  if (timeframe === "1d") return new Date(c.time).toISOString().split("T")[0];
  return new Date(c.time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ============================================================
// Concurrency limiter (semaphore pattern)
// ============================================================
class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];
  constructor(limit: number) { this.count = limit; }
  async acquire(): Promise<void> {
    if (this.count > 0) { this.count--; return; }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}

// ============================================================
// Basic read/write
// ============================================================
export async function getCandlesFromCache(
  symbol: string, timeframe: string, startDate: string, endDate: string
): Promise<Candle[] | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const candles = await db.select({
      date: historicalCandleCache.date,
      open: historicalCandleCache.open,
      high: historicalCandleCache.high,
      low: historicalCandleCache.low,
      close: historicalCandleCache.close,
      volume: historicalCandleCache.volume,
    }).from(historicalCandleCache).where(
      and(
        eq(historicalCandleCache.symbol, symbol),
        eq(historicalCandleCache.timeframe, timeframe),
        gte(historicalCandleCache.date, startDate),
        lte(historicalCandleCache.date, endDate)
      )
    ).orderBy(historicalCandleCache.date).limit(10000);
    if (candles.length === 0) return null;
    return candles.map(c => ({
      time: new Date(c.date).getTime(),
      open: Number(c.open), high: Number(c.high), low: Number(c.low),
      close: Number(c.close), volume: Number(c.volume),
    }));
  } catch (error) {
    console.error(`[Cache] Error fetching ${symbol}/${timeframe}:`, error);
    return null;
  }
}

export async function saveCandlesToCache(symbol: string, timeframe: string, candles: Candle[]): Promise<void> {
  if (candles.length === 0) return;
  try {
    const db = await getDb();
    if (!db) return;
    for (let i = 0; i < candles.length; i += SAVE_BATCH_SIZE) {
      const batch = candles.slice(i, i + SAVE_BATCH_SIZE);
      const values = batch.map(c => ({
        symbol, timeframe,
        date: candleDateKey(c, timeframe),
        open: String(c.open), high: String(c.high), low: String(c.low),
        close: String(c.close), volume: c.volume,
      }));
      try {
        await db.insert(historicalCandleCache).values(values).onDuplicateKeyUpdate({
          set: {
            open: sql`VALUES(open)`,
            high: sql`VALUES(high)`,
            low: sql`VALUES(low)`,
            close: sql`VALUES(close)`,
            volume: sql`VALUES(volume)`,
          }
        });
      } catch (err: any) {
        if (!err?.message?.includes("Duplicate")) throw err;
      }
    }
    await updateCacheMetadata(symbol, timeframe);
  } catch (error) {
    console.error(`[Cache] Error saving ${symbol}/${timeframe}:`, error);
  }
}

async function updateCacheMetadata(symbol: string, timeframe: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const stats = await db.select({
      cnt: sql<number>`COUNT(*)`,
      oldest: sql<string>`MIN(date)`,
      newest: sql<string>`MAX(date)`,
    }).from(historicalCandleCache).where(
      and(eq(historicalCandleCache.symbol, symbol), eq(historicalCandleCache.timeframe, timeframe))
    );
    if (!stats[0]) return;
    const cnt = Number(stats[0].cnt) || 0;
    if (cnt === 0) return;
    const { oldest, newest } = stats[0];
    const existing = await db.select().from(cacheMetadata).where(
      and(eq(cacheMetadata.symbol, symbol), eq(cacheMetadata.timeframe, timeframe))
    ).limit(1);
    if (existing.length === 0) {
      await db.insert(cacheMetadata).values({
        symbol, timeframe,
        oldestDate: oldest || new Date().toISOString().split('T')[0],
        newestDate: newest || new Date().toISOString().split('T')[0],
        candleCount: cnt, status: "partial",
      });
    } else {
      await db.update(cacheMetadata).set({
        oldestDate: oldest || new Date().toISOString().split('T')[0],
        newestDate: newest || new Date().toISOString().split('T')[0],
        candleCount: cnt, status: "partial",
      }).where(and(eq(cacheMetadata.symbol, symbol), eq(cacheMetadata.timeframe, timeframe)));
    }
  } catch (error) {
    console.error(`[Cache] Error updating metadata for ${symbol}/${timeframe}:`, error);
  }
}

// ============================================================
// Progress tracking (global state)
// ============================================================
let isCacheWarming = false;
let cacheWarmingProgress = {
  total: 0,
  completed: 0,
  skipped: 0,
  current: "",
  errors: 0,
  retrying: 0,
  sourceStats: {} as Record<string, { success: number; failed: number }>,
  startTime: 0,
  isWarming: false,
  speed: 0,
  elapsedSeconds: 0,
};

export function getCacheWarmingStatus() {
  const elapsed = cacheWarmingProgress.startTime
    ? (Date.now() - cacheWarmingProgress.startTime) / 1000
    : 0;
  const speed = elapsed > 0 ? Math.round(cacheWarmingProgress.completed / elapsed * 10) / 10 : 0;
  const { isWarming: _ignored, ...progressRest } = cacheWarmingProgress;
  return {
    isWarming: isCacheWarming,
    ...progressRest,
    speed,
    elapsedSeconds: Math.round(elapsed),
  };
}

// ============================================================
// Concurrent batch processing helpers
// ============================================================

async function saveAllConcurrently(
  symbolCandles: Map<string, Candle[]>,
  timeframe: string
): Promise<void> {
  const savePromises = Array.from(symbolCandles.entries()).map(([symbol, candles]) =>
    saveCandlesToCache(symbol, timeframe, candles).catch(err =>
      console.error(`[Cache] Save failed for ${symbol}/${timeframe}:`, err)
    )
  );
  await Promise.allSettled(savePromises);
}

async function processConcurrentBatch(
  symbolsWithDates: Array<{ symbol: string; startDate: string }>,
  timeframe: Timeframe,
  endDate: string,
  semaphore: Semaphore,
  onSymbolDone: (symbol: string, success: boolean) => void
): Promise<{ successes: Map<string, Candle[]>; failures: string[] }> {
  const successes = new Map<string, Candle[]>();
  const failures: string[] = [];

  const tasks = symbolsWithDates.map(({ symbol, startDate }) => async () => {
    await semaphore.acquire();
    try {
      const candles = await fetchHistoricalCandles(symbol, timeframe, startDate, endDate);
      if (candles.length > 0) {
        successes.set(symbol, candles);
        onSymbolDone(symbol, true);
      } else {
        failures.push(symbol);
        onSymbolDone(symbol, false);
      }
    } catch {
      failures.push(symbol);
      onSymbolDone(symbol, false);
    } finally {
      semaphore.release();
    }
  });

  await Promise.allSettled(tasks.map(t => t()));
  return { successes, failures };
}

// ============================================================
// Main warmCache function - v4.9 with EODHD + Semaphore fallback
// ============================================================
export async function warmCacheForSymbols(
  symbols: string[],
  timeframes: Timeframe[] = ["1d"],
  onProgress?: (msg: string) => void
): Promise<{ success: number; failed: number; skipped: number }> {
  if (isCacheWarming) throw new Error("Cache warming already in progress");
  isCacheWarming = true;
  cacheWarmingProgress = {
    total: symbols.length * timeframes.length,
    completed: 0,
    skipped: 0,
    current: "初始化...",
    errors: 0,
    retrying: 0,
    sourceStats: {},
    startTime: Date.now(),
    speed: 0,
    elapsedSeconds: 0,
    isWarming: true,
  };

  // Broadcast start immediately
  broadcastCacheWarmingStart(symbols.length * timeframes.length);

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // Helper to broadcast progress
  function broadcastProgress(current: string) {
    const elapsed = (Date.now() - cacheWarmingProgress.startTime) / 1000;
    const speed = elapsed > 0 ? Math.round(cacheWarmingProgress.completed / elapsed * 10) / 10 : 0;
    cacheWarmingProgress.speed = speed;
    cacheWarmingProgress.elapsedSeconds = Math.round(elapsed);
    const pct = cacheWarmingProgress.total > 0
      ? Math.round((cacheWarmingProgress.completed / cacheWarmingProgress.total) * 100)
      : 0;
    broadcastCacheWarmingProgress({
      type: "progress",
      total: cacheWarmingProgress.total,
      completed: cacheWarmingProgress.completed,
      skipped: cacheWarmingProgress.skipped,
      current,
      percentage: pct,
      sourceStats: cacheWarmingProgress.sourceStats,
      elapsed: Math.round(elapsed),
      speed: parseFloat((cacheWarmingProgress.speed || 0).toFixed(1)),
    });
  }

  try {
    for (const tf of timeframes) {
      const now = new Date();
      const years = HISTORY_YEARS[tf] || 5;
      const fullStartDate = formatDate(new Date(now.getTime() - years * 365 * 86400000));
      const endDate = formatDate(now);
      const upToDateThreshold = formatDate(new Date(now.getTime() - UP_TO_DATE_DAYS * 86400000));

      // -------------------------------------------------------
      // Step 0: Load existing cache metadata (one batch DB query)
      // -------------------------------------------------------
      cacheWarmingProgress.current = `${tf}: 检查已有缓存状态...`;
      onProgress?.(cacheWarmingProgress.current);
      broadcastProgress(cacheWarmingProgress.current);

      const existingMeta = new Map<string, string>(); // symbol -> newestDate
      try {
        const db = await getDb();
        if (db) {
          const metas = await db.select({
            symbol: cacheMetadata.symbol,
            newestDate: cacheMetadata.newestDate,
          }).from(cacheMetadata).where(eq(cacheMetadata.timeframe, tf));
          for (const m of metas) {
            if (m.newestDate) existingMeta.set(m.symbol, m.newestDate);
          }
        }
      } catch { /* ignore */ }

      // Classify symbols
      const symbolsToSkip: string[] = [];
      const symbolsToProcess: Array<{ symbol: string; startDate: string; isIncremental: boolean }> = [];

      for (const sym of symbols) {
        const newest = existingMeta.get(sym);
        if (!newest) {
          symbolsToProcess.push({ symbol: sym, startDate: fullStartDate, isIncremental: false });
        } else if (newest >= upToDateThreshold) {
          symbolsToSkip.push(sym);
        } else {
          const nextDay = formatDate(new Date(new Date(newest).getTime() + 86400000));
          symbolsToProcess.push({ symbol: sym, startDate: nextDay, isIncremental: true });
        }
      }

      const fullCount = symbolsToProcess.filter(s => !s.isIncremental).length;
      const incrCount = symbolsToProcess.filter(s => s.isIncremental).length;
      console.log(`[Cache v4.9] ${tf}: skip=${symbolsToSkip.length}, incremental=${incrCount}, full=${fullCount}`);

      // Update totals
      cacheWarmingProgress.total = symbolsToProcess.length * timeframes.length;
      cacheWarmingProgress.skipped = symbolsToSkip.length;
      totalSkipped += symbolsToSkip.length;

      cacheWarmingProgress.current = `${tf}: 跳过${symbolsToSkip.length}只(已最新), 增量${incrCount}只, 全量${fullCount}只`;
      onProgress?.(cacheWarmingProgress.current);
      broadcastProgress(cacheWarmingProgress.current);

      if (symbolsToProcess.length === 0) {
        console.log(`[Cache v4.9] ${tf}: All symbols up-to-date, skipping.`);
        continue;
      }

      // -------------------------------------------------------
      // Phase 1: EODHD 50-concurrent batch (replaces Alpaca)
      // Only works for full-fetch symbols (incremental need per-symbol startDate)
      // -------------------------------------------------------
      const eodhd_succeeded = new Set<string>();
      const eodhd_failed: Array<{ symbol: string; startDate: string }> = [];

      const batchableSymbols = symbolsToProcess.filter(s => !s.isIncremental).map(s => s.symbol);
      const incrementalSymbols = symbolsToProcess.filter(s => s.isIncremental);

      if (ENV.eodhdApiKey && batchableSymbols.length > 0) {
        const totalBatches = Math.ceil(batchableSymbols.length / EODHD_BATCH_SIZE);
        cacheWarmingProgress.current = `${tf}: EODHD 批量全量 (${totalBatches} 批, 每批${EODHD_CONCURRENCY}并发)...`;
        onProgress?.(cacheWarmingProgress.current);
        broadcastProgress(cacheWarmingProgress.current);

        for (let i = 0; i < batchableSymbols.length; i += EODHD_BATCH_SIZE) {
          const batch = batchableSymbols.slice(i, i + EODHD_BATCH_SIZE);
          const batchNum = Math.floor(i / EODHD_BATCH_SIZE) + 1;
          cacheWarmingProgress.current = `${tf}: EODHD 批次 ${batchNum}/${totalBatches} (${batch.length} 只)`;
          onProgress?.(cacheWarmingProgress.current);
          broadcastProgress(cacheWarmingProgress.current);

          try {
            const batchResult = await fetchEODHDBatchCandles(batch, tf, fullStartDate, endDate);
            const saveMap = new Map<string, Candle[]>();

            for (const [sym, candles] of Array.from(batchResult.entries())) {
              if (candles.length > 0) {
                saveMap.set(sym, candles);
                eodhd_succeeded.add(sym);
              } else {
                eodhd_failed.push({ symbol: sym, startDate: fullStartDate });
              }
            }
            for (const sym of batch) {
              if (!batchResult.has(sym)) eodhd_failed.push({ symbol: sym, startDate: fullStartDate });
            }

            await saveAllConcurrently(saveMap, tf);
            cacheWarmingProgress.completed += batch.length;
            totalSuccess += saveMap.size;

            if (!cacheWarmingProgress.sourceStats["eodhd"]) {
              cacheWarmingProgress.sourceStats["eodhd"] = { success: 0, failed: 0 };
            }
            cacheWarmingProgress.sourceStats["eodhd"].success += saveMap.size;
            cacheWarmingProgress.sourceStats["eodhd"].failed += (batch.length - saveMap.size);

            broadcastProgress(`${tf}: EODHD 批次 ${batchNum}/${totalBatches} 完成 (${saveMap.size}/${batch.length})`);
            console.log(`[Cache v4.9] EODHD batch ${batchNum}/${totalBatches}: ${saveMap.size}/${batch.length} succeeded`);
          } catch (err) {
            console.error(`[Cache v4.9] EODHD batch ${batchNum} failed:`, err);
            for (const sym of batch) eodhd_failed.push({ symbol: sym, startDate: fullStartDate });
            cacheWarmingProgress.completed += batch.length;
            broadcastProgress(`${tf}: EODHD 批次 ${batchNum} 失败，转入 fallback`);
          }

          if (i + EODHD_BATCH_SIZE < batchableSymbols.length) {
            await new Promise(r => setTimeout(r, 200));
          }
        }

        console.log(`[Cache v4.9] EODHD phase done: ${eodhd_succeeded.size} succeeded, ${eodhd_failed.length} need fallback`);
      } else {
        // No EODHD key - all batchable symbols go to fallback
        for (const sym of batchableSymbols) eodhd_failed.push({ symbol: sym, startDate: fullStartDate });
        cacheWarmingProgress.completed += batchableSymbols.length;
      }

      // -------------------------------------------------------
      // Phase 2: Semaphore-8 concurrent fallback
      // For EODHD failures + all incremental symbols
      // Uses fetchHistoricalCandles failover chain (Yahoo → Tiingo → Finnhub → ...)
      // -------------------------------------------------------
      const fallbackSymbols = [...eodhd_failed, ...incrementalSymbols];

      if (fallbackSymbols.length > 0) {
        const uniqueFallback = Array.from(
          new Map(fallbackSymbols.map(s => [s.symbol, s])).values()
        );
        console.log(`[Cache v4.9] Fallback phase: ${uniqueFallback.length} symbols, concurrency=${CONCURRENCY}`);

        // Adjust completed count (EODHD phase already counted these)
        cacheWarmingProgress.completed -= eodhd_failed.length;

        cacheWarmingProgress.current = `${tf}: 并发补充 ${uniqueFallback.length} 只 (并发=${CONCURRENCY})...`;
        onProgress?.(cacheWarmingProgress.current);
        broadcastProgress(cacheWarmingProgress.current);

        const semaphore = new Semaphore(CONCURRENCY);
        let fallbackSuccess = 0;
        let fallbackFailed = 0;

        const { successes, failures } = await processConcurrentBatch(
          uniqueFallback,
          tf,
          endDate,
          semaphore,
          (symbol, success) => {
            if (success) {
              fallbackSuccess++;
              if (!cacheWarmingProgress.sourceStats["fallback"]) {
                cacheWarmingProgress.sourceStats["fallback"] = { success: 0, failed: 0 };
              }
              cacheWarmingProgress.sourceStats["fallback"].success++;
            } else {
              fallbackFailed++;
            }
            cacheWarmingProgress.completed++;
            const elapsed = (Date.now() - cacheWarmingProgress.startTime) / 1000;
            const speed = elapsed > 0 ? (cacheWarmingProgress.completed / elapsed).toFixed(1) : "0";
            const msg = `${tf}: 并发补充 ${cacheWarmingProgress.completed}/${cacheWarmingProgress.total} (${speed}/s) - ${symbol}`;
            cacheWarmingProgress.current = msg;
            broadcastProgress(msg);
          }
        );

        if (successes.size > 0) {
          await saveAllConcurrently(successes, tf);
        }

        totalSuccess += fallbackSuccess;
        totalFailed += fallbackFailed;
        cacheWarmingProgress.errors = totalFailed;

        console.log(`[Cache v4.9] Fallback phase done: ${fallbackSuccess} succeeded, ${fallbackFailed} failed`);

        // -------------------------------------------------------
        // Phase 3: Retry for permanently failed symbols
        // -------------------------------------------------------
        if (failures.length > 0) {
          cacheWarmingProgress.retrying = failures.length;
          cacheWarmingProgress.current = `${tf}: 重试 ${failures.length} 只失败股票...`;
          onProgress?.(cacheWarmingProgress.current);
          broadcastProgress(cacheWarmingProgress.current);

          console.log(`[Cache v4.9] Retry phase: ${failures.length} symbols`);

          const retrySemaphore = new Semaphore(Math.max(2, Math.floor(CONCURRENCY / 2)));
          const retrySymbols = failures.map(sym => ({ symbol: sym, startDate: fullStartDate }));

          const { successes: retrySuccesses, failures: finalFailures } = await processConcurrentBatch(
            retrySymbols,
            tf,
            endDate,
            retrySemaphore,
            (symbol, success) => {
              if (success) {
                totalSuccess++;
                totalFailed = Math.max(0, totalFailed - 1);
                if (!cacheWarmingProgress.sourceStats["retry"]) {
                  cacheWarmingProgress.sourceStats["retry"] = { success: 0, failed: 0 };
                }
                cacheWarmingProgress.sourceStats["retry"].success++;
              }
              cacheWarmingProgress.retrying = Math.max(0, cacheWarmingProgress.retrying - 1);
              cacheWarmingProgress.current = `${tf}: 重试中... (剩余 ${cacheWarmingProgress.retrying})`;
              broadcastProgress(cacheWarmingProgress.current);
            }
          );

          if (retrySuccesses.size > 0) {
            await saveAllConcurrently(retrySuccesses, tf);
          }

          totalFailed = finalFailures.length;
          cacheWarmingProgress.errors = totalFailed;

          console.log(`[Cache v4.9] Retry phase done: ${retrySuccesses.size} recovered, ${finalFailures.length} permanently failed`);
        }
      }
    }
  } finally {
    isCacheWarming = false;
    cacheWarmingProgress.isWarming = false;
    const elapsed = Math.round((Date.now() - cacheWarmingProgress.startTime) / 1000);
    const finalMsg = totalFailed > 0
      ? `完成: ${totalSuccess} 成功, ${totalSkipped} 跳过(已最新), ${totalFailed} 失败 (耗时 ${elapsed}s)`
      : `全部完成: ${totalSuccess} 成功, ${totalSkipped} 跳过(已最新) (耗时 ${elapsed}s)`;
    cacheWarmingProgress.current = finalMsg;
    onProgress?.(finalMsg);

    // Broadcast completion via WebSocket
    broadcastCacheWarmingComplete(
      totalSuccess + totalSkipped,
      totalSuccess + totalSkipped,
      totalSkipped,
      cacheWarmingProgress.sourceStats,
      Date.now() - cacheWarmingProgress.startTime
    );

    console.log(`[Cache v4.9] Warming complete: ${totalSuccess} success, ${totalSkipped} skipped, ${totalFailed} failed, ${elapsed}s elapsed`);

    // Push owner notification
    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;
    const elapsedStr = elapsedMin > 0 ? `${elapsedMin}分${elapsedSec}秒` : `${elapsedSec}秒`;
    notifyOwner({
      title: `✅ 缓存预热完成 (${totalSuccess + totalSkipped}/${symbols.length})`,
      content: [
        `**成功缓存：** ${totalSuccess} 只`,
        `**跳过（已最新）：** ${totalSkipped} 只`,
        `**失败：** ${totalFailed} 只`,
        `**耗时：** ${elapsedStr}`,
        totalFailed > 0 ? `\n⚠️ 有 ${totalFailed} 只股票缓存失败，请前往缓存管理页面查看详情。` : "",
      ].filter(Boolean).join("\n"),
    }).catch(err => console.warn("[Cache] notifyOwner failed:", err));
  }

  return { success: totalSuccess, failed: totalFailed, skipped: totalSkipped };
}

// ============================================================
// getCacheStatus - returns all cache metadata
// ============================================================
export async function getCacheStatus(): Promise<Array<{
  symbol: string; timeframe: string; candleCount: number | null;
  oldestDate: string | null; newestDate: string | null; status: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    symbol: cacheMetadata.symbol,
    timeframe: cacheMetadata.timeframe,
    candleCount: cacheMetadata.candleCount,
    oldestDate: cacheMetadata.oldestDate,
    newestDate: cacheMetadata.newestDate,
    status: cacheMetadata.status,
  }).from(cacheMetadata).orderBy(cacheMetadata.symbol, cacheMetadata.timeframe);
}

/**
 * Get candles with cache-first strategy.
 */
export async function getCandlesWithCache(
  symbol: string, timeframe: Timeframe, startDate?: string, endDate?: string
): Promise<Candle[]> {
  const now = new Date();
  const sd = startDate || formatDate(new Date(now.getTime() - (HISTORY_YEARS[timeframe] || 5) * 365 * 86400000));
  const ed = endDate || formatDate(now);

  try {
    const cached = await getCandlesFromCache(symbol, timeframe, sd, ed);
    if (cached && cached.length > 0) {
      const newestCached = cached[cached.length - 1];
      const newestDate = new Date(newestCached.time);
      const twoDaysAgo = new Date(now.getTime() - 2 * 86400000);
      if (newestDate >= twoDaysAgo) {
        return cached;
      }
      const nextDay = formatDate(new Date(newestDate.getTime() + 86400000));
      Promise.race([
        fetchHistoricalCandles(symbol, timeframe, nextDay, ed),
        new Promise<Candle[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
      ]).then(newCandles => {
        if (newCandles.length > 0) saveCandlesToCache(symbol, timeframe, newCandles).catch(() => {});
      }).catch(() => {});
      return cached;
    }
  } catch { /* ignore cache errors */ }

  console.warn(`[Cache] No cache found for ${symbol}/${timeframe} - returning empty array (cache-first mode)`);
  return [];
}

// ============================================================
// getCacheMetadata - get metadata for a single symbol
// ============================================================
export async function getCacheMetadata(
  symbol: string, timeframe: string
): Promise<{ newestDate: string | null; oldestDate: string | null; candleCount: number | null } | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select({
      newestDate: cacheMetadata.newestDate,
      oldestDate: cacheMetadata.oldestDate,
      candleCount: cacheMetadata.candleCount,
    }).from(cacheMetadata).where(
      and(eq(cacheMetadata.symbol, symbol), eq(cacheMetadata.timeframe, timeframe))
    ).limit(1);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ============================================================
// getFailedSymbols - symbols with no cache or very old cache
// ============================================================
export async function getFailedSymbols(allSymbols: string[], timeframe: string = "1d"): Promise<{
  failed: string[];
  cachedCount: number;
  total: number;
}> {
  try {
    const db = await getDb();
    if (!db) return { failed: allSymbols, cachedCount: 0, total: allSymbols.length };

    const metas = await db.select({
      symbol: cacheMetadata.symbol,
      newestDate: cacheMetadata.newestDate,
    }).from(cacheMetadata).where(eq(cacheMetadata.timeframe, timeframe));

    const metaMap = new Map(metas.map(m => [m.symbol, m.newestDate]));
    const now = new Date();
    const threshold = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

    const failed = allSymbols.filter(sym => {
      const newest = metaMap.get(sym);
      return !newest || newest < threshold;
    });

    return {
      failed,
      cachedCount: allSymbols.length - failed.length,
      total: allSymbols.length,
    };
  } catch {
    return { failed: allSymbols, cachedCount: 0, total: allSymbols.length };
  }
}

// ============================================================
// getMetadataTimeline - for cache timeline visualization
// ============================================================
export async function getMetadataTimeline(limit: number = 100): Promise<Array<{
  symbol: string; timeframe: string; newestDate: string | null; candleCount: number | null;
}>> {
  try {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      symbol: cacheMetadata.symbol,
      timeframe: cacheMetadata.timeframe,
      newestDate: cacheMetadata.newestDate,
      candleCount: cacheMetadata.candleCount,
    }).from(cacheMetadata)
      .orderBy(cacheMetadata.newestDate)
      .limit(limit);
  } catch {
    return [];
  }
}
