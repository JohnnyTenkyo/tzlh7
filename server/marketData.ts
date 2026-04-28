/**
 * Market Data v4 - Multi-source K-line data with batch requests
 * All sources support batch requests (100 symbols per request)
 * Priority order: EODHD → Tiingo → Finnhub → AlphaVantage → Polygon → TwelveData → Stooq → Yahoo → MarketStack
 */
import axios from "axios";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { dataSourceHealth } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

export interface Candle {
  time: number; // ms timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "15m" | "30m" | "1h" | "2h" | "3h" | "4h" | "1d" | "1w";
export type DataSource = "eodhd" | "tiingo" | "finnhub" | "alphavantage" | "polygon" | "twelvedata" | "stooq" | "yahoo" | "marketstack";

export const BASE_TIMEFRAMES = ["15m", "1h", "1d"];
export const AGGREGATED_TIMEFRAMES: Record<string, { base: string; factor: number; mode: string }> = {
  "30m": { base: "15m", factor: 2, mode: "factor" },
  "2h": { base: "1h", factor: 2, mode: "factor" },
  "3h": { base: "1h", factor: 3, mode: "factor" },
  "4h": { base: "1h", factor: 4, mode: "factor" },
  "1w": { base: "1d", factor: 5, mode: "week" },
};

const BATCH_SIZE = 100; // All sources batch 100 symbols per request

// ============================================================
// Aggregation helpers
// ============================================================
function aggregateByFactor(candles: Candle[], factor: number): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    if (group.length === 0) continue;
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((s, c) => s + c.volume, 0),
    });
  }
  return result;
}

function aggregateToWeekly(candles: Candle[]): Candle[] {
  const weeks = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = new Date(c.time);
    const dayOfWeek = d.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setUTCDate(monday.getUTCDate() + mondayOffset);
    const key = monday.toISOString().split("T")[0];
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key)!.push(c);
  }
  return Array.from(weeks.entries()).map(([, group]) => ({
    time: group[0].time,
    open: group[0].open,
    high: Math.max(...group.map(c => c.high)),
    low: Math.min(...group.map(c => c.low)),
    close: group[group.length - 1].close,
    volume: group.reduce((s, c) => s + c.volume, 0),
  })).sort((a, b) => a.time - b.time);
}

// ============================================================
// Batch data source implementations
// ============================================================

// --- EODHD Batch (free tier, 100 symbols per request, 100k calls/day) ---
export async function fetchEODHDBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.eodhdApiKey;
  if (!apiKey) throw new Error("EODHD_API_KEY not set");
  if (timeframe !== "1d") throw new Error("EODHD batch: only 1d supported");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  // Process with 50 concurrent requests (same as Yahoo)
  const CONCURRENCY = 50;
  const DELAY_MS = 20; // 20ms between requests to avoid rate limiting

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (symbol) => {
      try {
        const res = await axios.get(`https://eodhd.com/api/eod/${symbol}.US`, {
          params: {
            api_token: apiKey,
            fmt: "json",
            from: startDate,
            to: endDate,
          },
          timeout: 10000,
        });

        if (!Array.isArray(res.data)) return;

        const candles: Candle[] = [];
        for (const item of res.data) {
          if (item.warning) continue;
          candles.push({
            time: new Date(item.date).getTime(),
            open: item.open || item.close,
            high: item.high || item.close,
            low: item.low || item.close,
            close: item.close,
            volume: item.volume || 0,
          });
        }
        if (candles.length > 0) {
          result.set(symbol, candles.sort((a, b) => a.time - b.time));
        }
      } catch (err) {
        console.warn(`[MarketData] EODHD fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    });

    await Promise.allSettled(promises);

    // Brief pause between concurrency groups
    if (i + CONCURRENCY < symbols.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return result;
}

// --- Tiingo Batch (daily, 1000 requests/hour) ---
export async function fetchTiingoBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.tiingoApiKey;
  if (!apiKey) throw new Error("TIINGO_API_KEY not set");
  if (timeframe !== "1d") throw new Error("Tiingo batch: only 1d supported");

    const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);
  // 20 concurrent (Tiingo: 1000 req/hour = ~16/min, 20 concurrent is safe)
  const CONCURRENCY = 20;
  let tiingoFatalError: Error | null = null;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    if (tiingoFatalError) break;
    const batch = symbols.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (symbol) => {
      try {
        const res = await axios.get(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices`, {
          params: { startDate, endDate, resampleFreq: "daily", token: apiKey },
          timeout: 8000,
        });
        if (!Array.isArray(res.data)) return;
        const candles: Candle[] = res.data.map((item: any) => ({
          time: new Date(item.date).getTime(),
          open: item.open || item.adjClose,
          high: item.high || item.adjClose,
          low: item.low || item.adjClose,
          close: item.adjClose || item.close,
          volume: item.volume || 0,
        })).sort((a: Candle, b: Candle) => a.time - b.time);
        if (candles.length > 0) {
          result.set(symbol, candles);
        }
      } catch (err: any) {
        if (err?.response?.status === 429) {
          tiingoFatalError = new Error('Tiingo rate limit exceeded (daily quota). Upgrade at https://api.tiingo.com/pricing');
          return;
        }
        console.warn(`[MarketData] Tiingo fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    });
    await Promise.allSettled(promises);
    if (i + CONCURRENCY < symbols.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  if (tiingoFatalError) throw tiingoFatalError;

  return result;
}

// --- Finnhub Batch (daily only, 60 requests/minute) ---
export async function fetchFinnhubBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.finnhubApiKey;
  if (!apiKey) throw new Error("FINNHUB_API_KEY not set");
  if (timeframe !== "1d") throw new Error("Finnhub batch: only 1d supported");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  const fromTs = Math.floor(new Date(startDate).getTime() / 1000);
  const toTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000);

  let finnhubFatalError: Error | null = null;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    if (finnhubFatalError) break;
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    for (const symbol of batch) {
      if (finnhubFatalError) break;
      try {
        const res = await axios.get("https://finnhub.io/api/v1/stock/candle", {
          params: { symbol, resolution: "D", from: fromTs, to: toTs, token: apiKey },
          timeout: 8000,
        });
        const data = res.data;
        if (data.s !== "ok" || !data.t) continue;

        const candles = data.t.map((t: number, i: number) => ({
          time: t * 1000,
          open: data.o[i],
          high: data.h[i],
          low: data.l[i],
          close: data.c[i],
          volume: data.v[i] || 0,
        }));

        if (candles.length > 0) {
          result.set(symbol, candles);
        }
      } catch (err: any) {
        if (err?.response?.status === 403) {
          finnhubFatalError = new Error('Finnhub free tier does not support historical candles. Upgrade at https://finnhub.io/pricing');
          break;
        }
        console.warn(`[MarketData] Finnhub fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    if (i + BATCH_SIZE < symbols.length && !finnhubFatalError) {
      await new Promise(r => setTimeout(r, 1000)); // 60 req/min = 1 req/sec
    }
  }
  if (finnhubFatalError) throw finnhubFatalError;

  return result;
}

// --- AlphaVantage Batch (5 requests/minute, daily only) ---
export async function fetchAlphaVantageBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.alphaVantageApiKey;
  if (!apiKey) throw new Error("ALPHAVANTAGE_API_KEY not set");
  if (timeframe !== "1d") throw new Error("AlphaVantage batch: only 1d supported");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    for (const symbol of batch) {
      try {
        const res = await axios.get("https://www.alphavantage.co/query", {
          params: { symbol, apikey: apiKey, outputsize: "compact", function: "TIME_SERIES_DAILY" },
          timeout: 8000,
        });
        if (res.data?.Note) {
          console.warn(`[MarketData] AlphaVantage rate limit for ${symbol}:`, res.data.Note);
          continue;
        }
        if (res.data?.Information) {
          console.warn(`[MarketData] AlphaVantage premium required for ${symbol}:`, res.data.Information);
          continue;
        }

        const timeSeriesKey = Object.keys(res.data).find(k => k.startsWith("Time Series"));
        if (!timeSeriesKey || !res.data[timeSeriesKey]) continue;

        const timeSeries = res.data[timeSeriesKey];
        const candles = Object.entries(timeSeries).map(([time, values]: any) => ({
          time: new Date(time).getTime(),
          dateStr: time,
          open: parseFloat(values["1. open"]),
          high: parseFloat(values["2. high"]),
          low: parseFloat(values["3. low"]),
          close: parseFloat(values["4. close"]),
          volume: parseInt(values["5. volume"] || "0"),
        })).filter((c: any) => c.dateStr >= startDate && c.dateStr <= endDate)
          .map(({ dateStr: _d, ...rest }: any) => rest as Candle)
          .sort((a: Candle, b: Candle) => a.time - b.time);

        if (candles.length > 0) {
          result.set(symbol, candles);
        }
      } catch (err) {
        console.warn(`[MarketData] AlphaVantage fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    if (i + BATCH_SIZE < symbols.length) {
      await new Promise(r => setTimeout(r, 12000)); // 5 req/min = 1 req/12sec
    }
  }

  return result;
}

// --- Polygon Batch (5 requests/minute, daily only) ---
export async function fetchPolygonBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.polygonApiKey;
  if (!apiKey) throw new Error("POLYGON_API_KEY not set");
  if (timeframe !== "1d") throw new Error("Polygon batch: only 1d supported");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    for (const symbol of batch) {
      try {
        const allCandles: Candle[] = [];
        let nextUrl: string | null = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;

        while (nextUrl) {
          const res: any = await axios.get(nextUrl, { timeout: 8000 });
          const results = res.data?.results;
          if (Array.isArray(results)) {
            for (const bar of results) {
              allCandles.push({ time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v || 0 });
            }
          }
          nextUrl = res.data?.next_url ? res.data.next_url + `&apiKey=${apiKey}` : null;
        }

        if (allCandles.length > 0) {
          result.set(symbol, allCandles.sort((a, b) => a.time - b.time));
        }
      } catch (err) {
        console.warn(`[MarketData] Polygon fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    if (i + BATCH_SIZE < symbols.length) {
      await new Promise(r => setTimeout(r, 12000)); // 5 req/min
    }
  }

  return result;
}

// --- TwelveData Batch (8 requests/minute, supports intraday) ---
export async function fetchTwelveDataBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.twelveDataApiKey;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY not set");
  if (!BASE_TIMEFRAMES.includes(timeframe)) throw new Error("TwelveData batch: unsupported timeframe");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  const intervalMap: Record<string, string> = { "15m": "15min", "1h": "1h", "1d": "1day" };
  const interval = intervalMap[timeframe];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    for (const symbol of batch) {
      try {
        const res = await axios.get("https://api.twelvedata.com/time_series", {
          params: { symbol, interval, start_date: startDate, end_date: endDate, outputsize: 5000, apikey: apiKey, format: "JSON" },
          timeout: 8000,
        });
        if (res.data?.status === "error") continue;

        const values = res.data?.values;
        if (!Array.isArray(values) || values.length === 0) continue;

        const candles = values.map((v: any) => ({
          time: new Date(v.datetime).getTime(),
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: parseInt(v.volume || "0"),
        })).sort((a, b) => a.time - b.time);

        if (candles.length > 0) {
          result.set(symbol, candles);
        }
      } catch (err) {
        console.warn(`[MarketData] TwelveData fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    if (i + BATCH_SIZE < symbols.length) {
      await new Promise(r => setTimeout(r, 7500)); // 8 req/min
    }
  }

  return result;
}

// --- Stooq Batch (free, daily only, no rate limit) ---
export async function fetchStooqBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  if (timeframe !== "1d") throw new Error("Stooq batch: only 1d supported");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    for (const symbol of batch) {
      try {
        const stooqSymbol = symbol.replace(".", "-") + ".US";
        const res = await axios.get(`https://stooq.com/q/d/l/`, {
          params: { s: stooqSymbol.toLowerCase(), i: "d" },
          timeout: 8000,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          responseType: "text",
        });
        const lines = (res.data as string).trim().split("\n");
        // Stooq now requires apikey - detect the error message
        if (lines[0]?.includes('Get your apikey') || lines[0]?.includes('apikey')) {
          throw new Error('Stooq requires API key. Register at https://stooq.com to get your apikey');
        }
        if (lines.length < 2) continue;

        const candles: Candle[] = [];
        for (let j = 1; j < lines.length; j++) {
          const parts = lines[j].split(",");
          if (parts.length < 5) continue;
          const [date, open, high, low, close, vol] = parts;
          const o = parseFloat(open);
          const h = parseFloat(high);
          const l = parseFloat(low);
          const c = parseFloat(close);
          if (isNaN(o) || isNaN(c)) continue;
          candles.push({
            time: new Date(date + "T00:00:00Z").getTime(),
            open: o,
            high: h,
            low: l,
            close: c,
            volume: parseInt(vol || "0") || 0,
          });
        }

        if (candles.length > 0) {
          result.set(symbol, candles.sort((a, b) => a.time - b.time));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('requires API key') || msg.includes('apikey')) {
          // Re-throw so testDataSource can record the correct error
          throw err;
        }
        console.warn(`[MarketData] Stooq fetch failed for ${symbol}:`, msg);
      }
    }
  }
  return result;
}
// --- Yahoo Finance Batch (50 concurrent, 200-300ms interval) ---
export async function fetchYahooBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  if (!BASE_TIMEFRAMES.includes(timeframe)) throw new Error("Yahoo batch: unsupported timeframe");

  const RANGE_MAP: Record<string, string> = { "15m": "60d", "1h": "730d", "1d": "10y" };
  const INTERVAL_MAP: Record<string, string> = { "15m": "15m", "1h": "60m", "1d": "1d" };
  const interval = INTERVAL_MAP[timeframe];
  const range = RANGE_MAP[timeframe];

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  const concurrency = 50;
  const delayMs = 250; // 250ms per request

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const promises = batch.map(async (symbol) => {
      try {
        const urls = [
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
        ];

        let res: any = null;
        for (const url of urls) {
          try {
            res = await axios.get(url, {
              params: { interval, range },
              timeout: 10000,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                Accept: "application/json,text/plain,*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                Referer: "https://finance.yahoo.com/",
              },
            });
            if (res.data?.chart?.result?.[0]) break;
          } catch { /* try next */ }
        }

        if (!res) return;
        const chartResult = res.data?.chart?.result?.[0];
        if (!chartResult) return;

        const timestamps: number[] = chartResult.timestamp || [];
        const quotes = chartResult.indicators?.quote?.[0];
        if (!quotes) return;

        const candles: Candle[] = [];
        for (let j = 0; j < timestamps.length; j++) {
          if (quotes.close[j] != null && !isNaN(quotes.close[j])) {
            candles.push({
              time: timestamps[j] * 1000,
              open: quotes.open[j] || quotes.close[j],
              high: quotes.high[j] || quotes.close[j],
              low: quotes.low[j] || quotes.close[j],
              close: quotes.close[j],
              volume: quotes.volume[j] || 0,
            });
          }
        }

        if (candles.length > 0) {
          result.set(symbol, candles);
        }
      } catch (err) {
        console.warn(`[MarketData] Yahoo fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }

      // Add delay between requests
      await new Promise(r => setTimeout(r, delayMs));
    });

    await Promise.allSettled(promises);
  }

  return result;
}

// --- MarketStack Batch (100/month, daily only) ---
export async function fetchMarketStackBatchCandles(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const apiKey = ENV.marketstackApiKey;
  if (!apiKey) throw new Error("MARKETSTACK_API_KEY not set");
  if (timeframe !== "1d") throw new Error("MarketStack batch: only 1d supported");

  const result = new Map<string, Candle[]>();
  for (const sym of symbols) result.set(sym, []);

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    for (const symbol of batch) {
      try {
        const allCandles: Candle[] = [];
        const limit = 100;
        let offset = 0;

        while (true) {
          const res: any = await axios.get("http://api.marketstack.com/v1/eod", {
            params: { access_key: apiKey, symbols: symbol, date_from: startDate, date_to: endDate, limit, offset, sort: "ASC" },
            timeout: 8000,
          });
          const data = res.data?.data;
          if (!Array.isArray(data) || data.length === 0) break;

          for (const bar of data) {
            allCandles.push({
              time: new Date(bar.date).getTime(),
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume || 0,
            });
          }

          if (data.length < limit) break;
          offset += limit;
        }

        if (allCandles.length > 0) {
          result.set(symbol, allCandles.sort((a, b) => a.time - b.time));
        }
      } catch (err) {
        console.warn(`[MarketData] MarketStack fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return result;
}

// ============================================================
// Health monitoring
// ============================================================
async function recordHealth(source: DataSource, timeframe: string, success: boolean, error?: string) {
  try {
    const db = await getDb();
    if (!db) return;
    const existing = await db.select().from(dataSourceHealth)
      .where(and(eq(dataSourceHealth.source, source), eq(dataSourceHealth.timeframe, timeframe))).limit(1);
    if (existing.length === 0) {
      await db.insert(dataSourceHealth).values({
        source, timeframe,
        successCount: success ? 1 : 0, failCount: success ? 0 : 1,
        lastSuccess: success ? new Date() : undefined, lastFail: success ? undefined : new Date(),
        lastError: error || null,
      }).catch(() => {});
    } else {
      if (success) {
        await db.update(dataSourceHealth)
          .set({ successCount: (existing[0].successCount || 0) + 1, lastSuccess: new Date() })
          .where(and(eq(dataSourceHealth.source, source), eq(dataSourceHealth.timeframe, timeframe)));
      } else {
        await db.update(dataSourceHealth)
          .set({ failCount: (existing[0].failCount || 0) + 1, lastFail: new Date(), lastError: error || null })
          .where(and(eq(dataSourceHealth.source, source), eq(dataSourceHealth.timeframe, timeframe)));
      }
    }
  } catch { /* ignore */ }
}

// ============================================================
// Unified fetch with failover (batch mode)
// ============================================================
async function getRawCandlesBatch(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  const sourceChains: Record<string, Array<{ name: DataSource; fn: Function }>> = {
    "1d": [
      { name: "eodhd", fn: fetchEODHDBatchCandles },
      { name: "tiingo", fn: fetchTiingoBatchCandles },
      { name: "finnhub", fn: fetchFinnhubBatchCandles },
      { name: "alphavantage", fn: fetchAlphaVantageBatchCandles },
      { name: "polygon", fn: fetchPolygonBatchCandles },
      { name: "twelvedata", fn: fetchTwelveDataBatchCandles },
      { name: "stooq", fn: fetchStooqBatchCandles },
      { name: "yahoo", fn: fetchYahooBatchCandles },
      { name: "marketstack", fn: fetchMarketStackBatchCandles },
    ],
    "1h": [
      { name: "twelvedata", fn: fetchTwelveDataBatchCandles },
      { name: "yahoo", fn: fetchYahooBatchCandles },
    ],
    "15m": [
      { name: "twelvedata", fn: fetchTwelveDataBatchCandles },
      { name: "yahoo", fn: fetchYahooBatchCandles },
    ],
  };

  const chain = sourceChains[timeframe];
  if (!chain) throw new Error(`No source chain for: ${timeframe}`);

  for (const source of chain) {
    try {
      console.log(`[MarketData] Trying ${source.name} batch for ${symbols.length} symbols/${timeframe}...`);
      const result = await source.fn(symbols, timeframe, startDate, endDate);
      
      // Count successful symbols
      let successCount = 0;
      for (const [, candles] of result.entries()) {
        if (candles.length > 0) successCount++;
      }

      if (successCount > 0) {
        console.log(`[MarketData] ✓ ${source.name} → ${successCount}/${symbols.length} symbols with candles`);
        recordHealth(source.name, timeframe, true).catch(() => {});
        return result;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MarketData] ✗ ${source.name} batch failed: ${msg}`);
      recordHealth(source.name, timeframe, false, msg).catch(() => {});
    }
  }

  console.error(`[MarketData] All batch sources failed for ${symbols.length} symbols/${timeframe}`);
  return new Map(symbols.map(s => [s, []]));
}

async function getAggregatedCandlesBatch(symbols: string[], timeframe: Timeframe, startDate: string, endDate: string): Promise<Map<string, Candle[]>> {
  const agg = AGGREGATED_TIMEFRAMES[timeframe];
  if (!agg) throw new Error(`${timeframe} is not aggregated`);
  
  const baseResult = await getRawCandlesBatch(symbols, agg.base as Timeframe, startDate, endDate);
  const result = new Map<string, Candle[]>();

  for (const [symbol, baseCandles] of Array.from(baseResult.entries())) {
    if (baseCandles.length === 0) {
      result.set(symbol, []);
    } else if (agg.mode === "week") {
      result.set(symbol, aggregateToWeekly(baseCandles));
    } else {
      result.set(symbol, aggregateByFactor(baseCandles, agg.factor));
    }
  }

  return result;
}

export async function fetchCandlesBatch(
  symbols: string[], timeframe: Timeframe, startDate: string, endDate: string
): Promise<Map<string, Candle[]>> {
  if (BASE_TIMEFRAMES.includes(timeframe)) return getRawCandlesBatch(symbols, timeframe, startDate, endDate);
  if (AGGREGATED_TIMEFRAMES[timeframe]) return getAggregatedCandlesBatch(symbols, timeframe, startDate, endDate);
  throw new Error(`Unsupported timeframe: ${timeframe}`);
}

// ============================================================
// Single-symbol fetch (for fallback/testing)
// ============================================================
export async function fetchHistoricalCandles(symbol: string, timeframe: Timeframe, startDate: string, endDate: string): Promise<Candle[]> {
  const result = await fetchCandlesBatch([symbol], timeframe, startDate, endDate);
  const candles = result.get(symbol) || [];
  const startTs = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const endTs = new Date(`${endDate}T23:59:59.999Z`).getTime();
  return candles.filter(c => Number.isFinite(c.time) && c.time >= startTs && c.time <= endTs).sort((a, b) => a.time - b.time);
}

// ============================================================
// Testing
// ============================================================
export async function testDataSource(
  source: DataSource,
  symbols: string[] = ["AAPL"]
): Promise<{ success: boolean; candleCount: number; latency: number; error?: string }> {
  const start = Date.now();
  try {
    const end = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const sourceMap: Record<DataSource, Function> = {
      eodhd: fetchEODHDBatchCandles,
      tiingo: fetchTiingoBatchCandles,
      finnhub: fetchFinnhubBatchCandles,
      alphavantage: fetchAlphaVantageBatchCandles,
      polygon: fetchPolygonBatchCandles,
      twelvedata: fetchTwelveDataBatchCandles,
      stooq: fetchStooqBatchCandles,
      yahoo: fetchYahooBatchCandles,
      marketstack: fetchMarketStackBatchCandles,
    };

    const fn = sourceMap[source];
    if (!fn) return { success: false, candleCount: 0, latency: 0, error: `Unknown source: ${source}` };

    const result = await fn(symbols, "1d", startDate, end);
    let totalCandles = 0;
    for (const candles of result.values()) {
      totalCandles += candles.length;
    }

    const latency = Date.now() - start;
    const ok = totalCandles > 0;
    await recordHealth(source, "1d", ok, ok ? undefined : "No candles returned");
    return { success: ok, candleCount: totalCandles, latency };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    await recordHealth(source, "1d", false, msg);
    return { success: false, candleCount: 0, latency, error: msg };
  }
}

// ============================================================
// Quote fetch
// ============================================================
export async function fetchQuote(symbol: string): Promise<{ price: number; change: number; changePercent: number }> {
  try {
    const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      params: { interval: "1d", range: "1d" },
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });
    const result = res.data?.chart?.result?.[0];
    if (result) {
      const quotes = result.indicators?.quote?.[0];
      const timestamps = result.timestamp;
      if (quotes && timestamps && timestamps.length > 0) {
        const price = quotes.close[timestamps.length - 1];
        const prevPrice = timestamps.length > 1 ? quotes.close[timestamps.length - 2] : price;
        return { price, change: price - prevPrice, changePercent: prevPrice > 0 ? (price - prevPrice) / prevPrice : 0 };
      }
    }
  } catch { /* fallback */ }

  throw new Error(`Unable to fetch quote for ${symbol}`);
}
