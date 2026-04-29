import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb, registerUser, verifyPassword, changePassword } from "./db";
import { backtestSessions, backtestTrades, dataSourceHealth, customDataSources, cacheMetadata, excludedSymbols, watchlist } from "../drizzle/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import type { Timeframe, DataSource } from "./marketData";
import { testDataSource } from "./marketData";
import { calculateMACD, calculateLadder, calculateCDSignals } from "./indicators";
import { getCandlesWithCache, getCacheStatus, getCacheWarmingStatus, warmCacheForSymbols } from "./cacheManager";
import { runBacktest, STRATEGY_INFO, STRATEGY_DEFAULTS, type StrategyType, type StrategyParams } from "./backtestEngine";
import { analyzeBacktestResult, generateGeminiStrategy, testGeminiConnection } from "./geminiStrategy";
import { scanStockPool, analyzeStock, getTodayTopSignals, saveScanResults, type StrategySignalType, type ScanOptions } from "./signalScanner";
import { scanResults } from "../drizzle/schema";
import { STOCK_POOL, filterStocks, type StockInfo, type StockSector, type MarketCapTier } from "@shared/stockPool";
import { SignJWT } from "jose";
import { ENV } from "./_core/env";
import * as XLSX from "xlsx";
import { notifyOwner } from "./_core/notification";

// Global set to track removed failed symbols
import { dataSourcePriorityRouter } from "./routers/dataSourcePriority";
const removedFailedSymbols = new Set<string>();
import { scanHistoryRouter } from "./routers/scanHistory";
import { marketCapRouter } from "./routers/marketCap";

function getJwtSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function createSessionToken(openId: string, name: string): Promise<string> {
  const secret = getJwtSecret();
  // Must include openId, appId, name to be compatible with sdk.verifySession()
  return new SignJWT({ openId, appId: ENV.appId || "local", name: name || openId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .sign(secret);
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    register: publicProcedure
      .input(z.object({
        username: z.string().min(2).max(32),
        password: z.string().min(4).max(64),
        name: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await registerUser(input.username, input.password, input.name);
        if (!user) throw new Error("注册失败");
        const token = await createSessionToken(user.openId, user.name || user.username || "");
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, username: user.username, name: user.name } };
      }),
    login: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const user = await verifyPassword(input.username, input.password);
        if (!user) throw new Error("用户名或密码错误");
        const token = await createSessionToken(user.openId, user.name || user.username || "");
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, username: user.username, name: user.name } };
      }),
    changePassword: protectedProcedure
      .input(z.object({
        oldPassword: z.string(),
        newPassword: z.string().min(4).max(64),
      }))
      .mutation(async ({ ctx, input }) => {
        await changePassword(ctx.user.id, input.oldPassword, input.newPassword);
        return { success: true };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  chart: router({
    getCandles: publicProcedure.input(z.object({
      symbol: z.string(),
      timeframe: z.string().default("1d"),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })).query(async ({ input }) => {
      const candles = await getCandlesWithCache(
        input.symbol, input.timeframe as Timeframe, input.startDate, input.endDate
      );
      return { candles };
    }),
    getIndicators: publicProcedure.input(z.object({
      symbol: z.string(),
      timeframe: z.string().default("1d"),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })).query(async ({ input }) => {
      const candles = await getCandlesWithCache(
        input.symbol, input.timeframe as Timeframe, input.startDate, input.endDate
      );
      if (candles.length < 30) return { macd: null, ladder: null, cdSignals: [] };
      const macd = calculateMACD(candles);
      const ladder = calculateLadder(candles);
      const cdSignals = calculateCDSignals(candles);
      return {
        macd: {
          diff: macd.diff.map((v, i) => ({ time: candles[i].time, value: v })),
          dea: macd.dea.map((v, i) => ({ time: candles[i].time, value: v })),
          macd: macd.macd.map((v, i) => ({ time: candles[i].time, value: v })),
        },
        ladder: ladder.map(l => ({
          time: l.time, blueUp: l.blueUp, blueDn: l.blueDn, blueMid: l.blueMid,
          yellowUp: l.yellowUp, yellowDn: l.yellowDn, yellowMid: l.yellowMid,
        })),
        cdSignals,
      };
    }),
    getAISignal: publicProcedure.input(z.object({
      symbol: z.string(),
      timeframe: z.string().default("1d"),
    })).query(async ({ input }) => {
      const candles = await getCandlesWithCache(input.symbol, input.timeframe as Timeframe);
      if (candles.length < 30) return { signal: "hold", confidence: 0.5, reasoning: "数据不足" };
      const macd = calculateMACD(candles);
      const ladder = calculateLadder(candles);
      const signal = await generateGeminiStrategy(input.symbol, candles, {
        macd: { diff: macd.diff, dea: macd.dea, macd: macd.macd },
        ladder,
      });
      return signal;
    }),
  }),

  stockPool: router({
    list: publicProcedure.input(z.object({
      // Legacy single-sector filter
      sector: z.string().optional(),
      // New multi-select filters (叠加筛选)
      sectors: z.array(z.string()).optional(),
      marketCapTiers: z.array(z.string()).optional(),
      customSymbols: z.array(z.string()).optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    })).query(({ input }) => {
      const hasNewFilters = (input.sectors && input.sectors.length > 0) ||
        (input.marketCapTiers && input.marketCapTiers.length > 0) ||
        (input.customSymbols && input.customSymbols.length > 0);
      let filtered: StockInfo[];
      if (hasNewFilters) {
        filtered = filterStocks(STOCK_POOL as StockInfo[], {
          sectors: input.sectors as StockSector[],
          marketCapTiers: input.marketCapTiers as MarketCapTier[],
          customSymbols: input.customSymbols,
          searchQuery: input.search,
        });
      } else {
        filtered = STOCK_POOL as StockInfo[];
        if (input.sector) filtered = filtered.filter(s => s.sectors.includes(input.sector as any));
        if (input.search) {
          const q = input.search.toLowerCase();
          filtered = filtered.filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
        }
      }
      const total = filtered.length;
      const start = (input.page - 1) * input.pageSize;
      const items = filtered.slice(start, start + input.pageSize);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),
    sectors: publicProcedure.query(() => {
      const sectorCounts: Record<string, number> = {};
      for (const stock of STOCK_POOL) {
        for (const sector of stock.sectors) sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
      }
      return Object.entries(sectorCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    }),
    symbols: publicProcedure.query(() => STOCK_POOL.map(s => ({ symbol: s.symbol, name: s.name }))),
  }),

  backtest: router({
    strategies: publicProcedure.query(() => {
      const strategies = Object.entries(STRATEGY_INFO).map(([key, info]) => ({
        key,
        name: info.name,
        description: info.description,
        defaults: STRATEGY_DEFAULTS[key as StrategyType],
      }));
      strategies.push({
        key: "gemini_ai",
        name: "Gemini AI 智能策略",
        description: "利用 Google Gemini AI 分析技术指标（MACD、黄蓝梯子、RSI、布林带）生成买卖信号。AI 综合多维度指标进行判断，适合捕捉复杂市场模式。",
        defaults: STRATEGY_DEFAULTS["standard"],
      });
      return strategies;
    }),

    create: protectedProcedure.input(z.object({
      name: z.string(),
      strategy: z.enum(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "gemini_ai", "vamr", "ravts", "rsi_reversal", "macd_divergence"]),
      symbols: z.array(z.string()).min(1),
      startDate: z.string(),
      endDate: z.string(),
      initialCapital: z.number().default(100000),
      maxPositionPct: z.number().default(10),
      strategyParams: z.record(z.string(), z.any()).optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const result = await db.insert(backtestSessions).values({
        userId: ctx.user.id, name: input.name, strategy: input.strategy as any,
        symbols: input.symbols, startDate: input.startDate, endDate: input.endDate,
        initialCapital: String(input.initialCapital), maxPositionPct: String(input.maxPositionPct),
        strategyParams: input.strategyParams || null,
      }).$returningId();
      const sessionId = result[0].id;
      const actualStrategy = input.strategy === "gemini_ai" ? "standard" : (input.strategy as any as StrategyType);
      // Convert frontend percentage integers to decimals for the engine
      // Frontend sends: stopLossPct=8 (8%), engine expects: 0.08
      const rawParams = input.strategyParams || {};
      const normalizedParams: StrategyParams = { ...rawParams } as any;
      const pctFields = ['stopLossPct', 'takeProfitPct', 'trailingStopPct'] as const;
      for (const field of pctFields) {
        const val = (rawParams as any)[field];
        if (val != null && typeof val === 'number' && val > 1) {
          // Value > 1 means it's a percentage integer (e.g. 8), convert to decimal (0.08)
          (normalizedParams as any)[field] = val / 100;
        }
      }
      runBacktest({
        sessionId, symbols: input.symbols, startDate: input.startDate, endDate: input.endDate,
        strategy: actualStrategy, initialCapital: input.initialCapital, maxPositionPct: input.maxPositionPct,
        strategyParams: normalizedParams,
      }).catch(err => console.error("[Backtest] Error:", err));
      return { sessionId };
    }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(backtestSessions)
        .where(eq(backtestSessions.userId, ctx.user.id))
        .orderBy(desc(backtestSessions.createdAt)).limit(100);
    }),

    detail: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessions = await db.select().from(backtestSessions).where(eq(backtestSessions.id, input.id)).limit(1);
      if (sessions.length === 0) throw new Error("Session not found");
      const session = sessions[0];
      if (session.userId !== ctx.user.id) throw new Error("Unauthorized");
      const trades = await db.select().from(backtestTrades)
        .where(eq(backtestTrades.sessionId, input.id)).orderBy(backtestTrades.tradeTime);
      
      // Calculate monthly statistics
      const monthlyStats: Record<string, any> = {};
      let totalProfit = 0, winCount = 0, totalTrades = 0;
      
      for (const trade of trades) {
        // 只统计卖出交易的利润（买入交易的 pnl 为 0）
        if (trade.side !== 'sell') continue;
        
        const tradeDate = new Date(Number(trade.tradeTime));
        const monthKey = tradeDate.toISOString().slice(0, 7);
        
        if (!monthlyStats[monthKey]) {
          monthlyStats[monthKey] = { trades: 0, wins: 0, losses: 0, profit: 0, winRate: 0 };
        }
        
        const profit = Number(trade.pnl) || 0;
        monthlyStats[monthKey].trades++;
        monthlyStats[monthKey].profit += profit;
        if (profit > 0) {
          monthlyStats[monthKey].wins++;
        } else if (profit < 0) {
          monthlyStats[monthKey].losses++;
        }
        
        totalProfit += profit;
        if (profit > 0) winCount++;
        totalTrades++;
      }
      
      for (const month in monthlyStats) {
        const stats = monthlyStats[month];
        stats.winRate = stats.trades > 0 ? (stats.wins / stats.trades * 100).toFixed(1) : 0;
      }
      
      // Calculate equity curve from trades
      const equityCurve: any[] = [];
      let currentEquity = Number(session.initialCapital || 100000);
      const initialEquity = currentEquity;
      let lastDate = new Date(session.startDate);
      
      // Sort trades by date
      const sortedTrades = [...trades].sort((a, b) => Number(a.tradeTime) - Number(b.tradeTime));
      
      // Calculate daily equity changes
      const dailyEquity: Record<string, number> = {};
      dailyEquity[new Date(session.startDate).toISOString().split('T')[0]] = initialEquity;
      
      for (const trade of sortedTrades) {
        if (trade.side !== 'sell') continue; // Only count sell trades for PnL
        const tradeDate = new Date(Number(trade.tradeTime)).toISOString().split('T')[0];
        const pnl = Number(trade.pnl) || 0;
        if (!dailyEquity[tradeDate]) {
          dailyEquity[tradeDate] = currentEquity;
        }
        currentEquity += pnl;
        dailyEquity[tradeDate] = currentEquity;
      }
      
      // Build equity curve - all values as percentage return from initial capital
      const dates = Object.keys(dailyEquity).sort();
      
      // Use real SPY/QQQ curves from resultSummary (saved by backtestEngine)
      const resultSummary = session.resultSummary as any;
      const spyCurveRaw: Array<{ time: number; equity: number }> = resultSummary?.spyCurve || [];
      const qqqCurveRaw: Array<{ time: number; equity: number }> = resultSummary?.qqqCurve || [];
      
      // Build lookup maps for real benchmark data by date string
      const spyByDate: Record<string, number> = {};
      const qqqByDate: Record<string, number> = {};
      for (const pt of spyCurveRaw) {
        const d = new Date(pt.time).toISOString().split('T')[0];
        spyByDate[d] = pt.equity;
      }
      for (const pt of qqqCurveRaw) {
        const d = new Date(pt.time).toISOString().split('T')[0];
        qqqByDate[d] = pt.equity;
      }
      
      // Fallback: if no real data in resultSummary, fetch from cache
      if (spyCurveRaw.length === 0) {
        try {
          const spyCandles = await getCandlesWithCache('SPY', '1d', session.startDate, session.endDate);
          if (spyCandles.length >= 2) {
            const base = spyCandles[0].close;
            for (const c of spyCandles) {
              const d = new Date(c.time).toISOString().split('T')[0];
              spyByDate[d] = initialEquity * (c.close / base);
            }
          }
        } catch {}
      }
      if (qqqCurveRaw.length === 0) {
        try {
          const qqqCandles = await getCandlesWithCache('QQQ', '1d', session.startDate, session.endDate);
          if (qqqCandles.length >= 2) {
            const base = qqqCandles[0].close;
            for (const c of qqqCandles) {
              const d = new Date(c.time).toISOString().split('T')[0];
              qqqByDate[d] = initialEquity * (c.close / base);
            }
          }
        } catch {}
      }
      
      // Interpolate benchmark values for dates not in map
      let lastSpy = initialEquity, lastQqq = initialEquity;
      for (const date of dates) {
        const equity = dailyEquity[date];
        if (spyByDate[date] !== undefined) lastSpy = spyByDate[date];
        if (qqqByDate[date] !== undefined) lastQqq = qqqByDate[date];
        equityCurve.push({
          date,
          strategy: parseFloat(((equity - initialEquity) / initialEquity * 100).toFixed(4)),
          spy: parseFloat(((lastSpy - initialEquity) / initialEquity * 100).toFixed(4)),
          qqq: parseFloat(((lastQqq - initialEquity) / initialEquity * 100).toFixed(4)),
        });
      }
      
      return { 
        session: { ...session, equityCurve: JSON.stringify(equityCurve) }, 
        trades, 
        monthlyStats, 
        summary: { totalProfit, winCount, totalTrades, winRate: totalTrades > 0 ? (winCount / totalTrades * 100).toFixed(1) : 0 } 
      };
    }),

    progress: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const sessions = await db.select({
        status: backtestSessions.status, progress: backtestSessions.progress,
        progressMessage: backtestSessions.progressMessage,
      }).from(backtestSessions).where(eq(backtestSessions.id, input.id)).limit(1);
      return sessions[0] || null;
    }),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessions = await db.select().from(backtestSessions).where(eq(backtestSessions.id, input.id)).limit(1);
      if (sessions.length === 0) throw new Error("Session not found");
      if (sessions[0].userId !== ctx.user.id) throw new Error("Unauthorized");
      await db.delete(backtestTrades).where(eq(backtestTrades.sessionId, input.id));
      await db.delete(backtestSessions).where(eq(backtestSessions.id, input.id));
      return { success: true };
    }),

    batchDelete: protectedProcedure.input(z.object({ ids: z.array(z.number()).min(1) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessions = await db.select().from(backtestSessions).where(inArray(backtestSessions.id, input.ids));
      const ownedIds = sessions.filter(s => s.userId === ctx.user.id).map(s => s.id);
      if (ownedIds.length === 0) throw new Error("No sessions found");
      await db.delete(backtestTrades).where(inArray(backtestTrades.sessionId, ownedIds));
      await db.delete(backtestSessions).where(inArray(backtestSessions.id, ownedIds));
      return { success: true, deleted: ownedIds.length };
    }),

    exportExcel: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessions = await db.select().from(backtestSessions).where(eq(backtestSessions.id, input.id)).limit(1);
      if (sessions.length === 0) throw new Error("Session not found");
      if (sessions[0].userId !== ctx.user.id) throw new Error("Unauthorized");
      const session = sessions[0];
      const trades = await db.select().from(backtestTrades)
        .where(eq(backtestTrades.sessionId, input.id)).orderBy(backtestTrades.tradeTime);
      const wb = XLSX.utils.book_new();
      const summaryData: any[] = [
        ["=== 回测配置 ==="],
        ["回测名称", session.name],
        ["策略", (STRATEGY_INFO as any)[session.strategy]?.name || session.strategy],
        ["开始日期", session.startDate],
        ["结束日期", session.endDate],
        ["初始资金", `$${Number(session.initialCapital).toLocaleString()}`],
        ["最大持仓比例", `${session.maxPositionPct}%`],
        [""],
        ["=== 策略参数 ==="],
      ];
      // Strategy param label mapping (Chinese)
      const PARAM_LABELS: Record<string, string> = {
        stopLossPct: '止损比例',
        takeProfitPct: '止盈比例',
        trailingStopPct: '移动止损比例',
        maxHoldingDays: '最大持仓天数',
        cdScoreThreshold: 'CD评分阈值',
        ladderConfirm: '梯子确认',
        secondTranchePct: '第二批仓比例',
        minCDStrength: '最小CD强度',
        requireMACDAccel: 'MACD加速确认',
        minLadderGap: '最小梯子间距',
        rsiOversold: 'RSI超卖阈值',
        rsiOverbought: 'RSI超买阈值',
        meanPeriod: '均値周期',
        volumeMultiplier: '量能倍数',
        macdFast: 'MACD快线周期',
        macdSlow: 'MACD慢线周期',
        macdSignal: 'MACD信号线周期',
        bbPeriod: '布林带周期',
        bbMultiplier: '布林带倍数',
        squeezeThreshold: '收缩阈值',
        volatilityPeriod: 'ATR周期',
        momentumPeriod: '动量周期',
        rsi4Threshold: 'RSI4超卖阈值',
        emaPeriod: 'EMA周期',
        volumeConfirmPct: '量能确认倍数',
        rsiPeriod: 'RSI周期',
        rsiReversal: 'RSI反转阈值',
        macdDivergencePeriod: 'MACD背离回望期',
      };
      const formatParamValue = (key: string, value: any): string => {
        if (value === null || value === undefined) return '不限';
        if (typeof value === 'boolean') return value ? '是' : '否';
        const pct = ['stopLossPct', 'takeProfitPct', 'trailingStopPct'];
        if (pct.includes(key) && typeof value === 'number') return `${(value * 100).toFixed(1)}%`;
        if (key === 'maxHoldingDays' && value === 0) return '不限';
        if (typeof value === 'object') {
          if (Array.isArray(value)) return value.join(', ');
          // For objects, format each property with its label
          try {
            const lines: string[] = [];
            for (const [k, v] of Object.entries(value)) {
              const label = PARAM_LABELS[k] || k;
              const formattedVal = formatParamValue(k, v);
              lines.push(`${label}: ${formattedVal}`);
            }
            return lines.join('; ');
          } catch { return String(value); }
        }
        return String(value);
      };
      if (session.strategyParams) {
        try {
          const params = typeof session.strategyParams === 'string' ? JSON.parse(session.strategyParams) : session.strategyParams;
          // Common risk params first
          const commonKeys = ['stopLossPct', 'takeProfitPct', 'trailingStopPct', 'maxHoldingDays'];
          for (const key of commonKeys) {
            if (key in params) {
              const label = PARAM_LABELS[key] || key;
              const value = params[key];
              let displayValue = '';
              if (value === null || value === undefined) displayValue = '不限';
              else if (key === 'stopLossPct' || key === 'takeProfitPct' || key === 'trailingStopPct') {
                displayValue = typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : String(value);
              } else if (key === 'maxHoldingDays') {
                displayValue = value === 0 ? '不限' : String(value);
              } else {
                displayValue = formatParamValue(key, value);
              }
              summaryData.push([label, displayValue]);
            }
          }
          // Strategy-specific params
          const extraKeys = Object.keys(params).filter(k => !commonKeys.includes(k));
          if (extraKeys.length > 0) {
            summaryData.push(['--- 策略特有参数 ---']);
            for (const key of extraKeys) {
              summaryData.push([PARAM_LABELS[key] || key, formatParamValue(key, params[key])]);
            }
          }
        } catch {}
      }
      summaryData.push(
        [""],
        ["=== 性能统计 ==="],
        ["总收益率", `${(Number(session.totalReturnPct) * 100).toFixed(2)}%`],
        ["总收益", `$${Number(session.totalReturn || 0).toFixed(2)}`],
        ["胜率", `${(Number(session.winRate) * 100).toFixed(1)}%`],
        ["最大回撤", `${(Number(session.maxDrawdown) * 100).toFixed(2)}%`],
        ["夏普比率", Number(session.sharpeRatio).toFixed(2)],
        ["基准收益(SPY)", `${(Number(session.benchmarkReturn) * 100).toFixed(2)}%`],
        ["总交易数", session.totalTrades],
        ["盈利交易", session.winningTrades],
        ["亏损交易", session.losingTrades],
      );
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, "回测概要");
      const tradeRows = trades.map(t => ({
        "时间": new Date(Number(t.tradeTime)).toLocaleString("zh-CN"),
        "股票": t.symbol,
        "方向": t.side === "buy" ? "买入" : "卖出",
        "数量": Number(t.quantity),
        "价格": `$${Number(t.price).toFixed(2)}`,
        "金额": `$${Number(t.totalAmount).toFixed(2)}`,
        "佣金": (t as any).commissionFee ? `$${Number((t as any).commissionFee).toFixed(2)}` : "-",
        "平台费": (t as any).platformFee ? `$${Number((t as any).platformFee).toFixed(2)}` : "-",
        "盈亏": `$${Number(t.pnl).toFixed(2)}`,
        "盈亏%": `${(Number(t.pnlPct) * 100).toFixed(2)}%`,
        "信号类型": t.signalType || "-",
        "买卖理由": t.reason || "-",
      }));
      const tradesWs = XLSX.utils.json_to_sheet(tradeRows);
      XLSX.utils.book_append_sheet(wb, tradesWs, "交易记录");
      const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
      const base64 = Buffer.from(buffer).toString("base64");
      return { filename: `backtest_${session.name}_${session.id}.xlsx`, base64 };
    }),

    // -------------------------------------------------------
    // Multi-strategy comparison: run multiple strategies in parallel
    // -------------------------------------------------------
    compareStrategies: protectedProcedure.input(z.object({
      name: z.string(),
      strategies: z.array(z.enum(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "gemini_ai", "vamr", "ravts", "rsi_reversal", "macd_divergence"])).min(2).max(10),
      symbols: z.array(z.string()).min(1),
      startDate: z.string(),
      endDate: z.string(),
      initialCapital: z.number().default(100000),
      maxPositionPct: z.number().default(10),
      strategyParams: z.record(z.string(), z.any()).optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessionIds: number[] = [];
      for (const strategy of input.strategies) {
        const stratInfo = STRATEGY_INFO[strategy as StrategyType];
        const sessionName = `[对比] ${input.name} - ${stratInfo?.name || strategy}`;
        const result = await db.insert(backtestSessions).values({
          userId: ctx.user.id, name: sessionName,
          strategy: strategy as any,
          symbols: input.symbols, startDate: input.startDate, endDate: input.endDate,
          initialCapital: String(input.initialCapital), maxPositionPct: String(input.maxPositionPct),
          strategyParams: input.strategyParams || null,
        }).$returningId();
        sessionIds.push(result[0].id);
      }
      // Run all backtests in parallel (background)
      input.strategies.forEach((strategy, i) => {
        const actualStrategy = strategy === "gemini_ai" ? "standard" : strategy as StrategyType;
        runBacktest({
          sessionId: sessionIds[i], symbols: input.symbols,
          startDate: input.startDate, endDate: input.endDate,
          strategy: actualStrategy, initialCapital: input.initialCapital,
          maxPositionPct: input.maxPositionPct,
          strategyParams: input.strategyParams as StrategyParams,
        }).catch(err => console.error(`[Compare] Strategy ${strategy} error:`, err));
      });
      return { sessionIds, count: sessionIds.length };
    }),

    // -------------------------------------------------------
    // Compare historical records: fetch multiple sessions for comparison
    // -------------------------------------------------------
    compareRecords: protectedProcedure.input(z.object({
      ids: z.array(z.number()).min(2).max(10),
    })).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessions = await db.select().from(backtestSessions)
        .where(inArray(backtestSessions.id, input.ids));
      const ownedSessions = sessions.filter(s => s.userId === ctx.user.id);
      if (ownedSessions.length === 0) throw new Error("No sessions found");
      // Build equityCurve for each session from trades
      const comparison = await Promise.all(ownedSessions.map(async s => {
        const sessionTrades = await db!.select().from(backtestTrades)
          .where(eq(backtestTrades.sessionId, s.id)).orderBy(backtestTrades.tradeTime);
        const initialEquity = Number(s.initialCapital || 100000);
        let currentEquity = initialEquity;
        const dailyEquity: Record<string, number> = {};
        dailyEquity[new Date(s.startDate).toISOString().split('T')[0]] = initialEquity;
        for (const trade of sessionTrades) {
          if (trade.side !== 'sell') continue;
          const tradeDate = new Date(Number(trade.tradeTime)).toISOString().split('T')[0];
          if (!dailyEquity[tradeDate]) dailyEquity[tradeDate] = currentEquity;
          currentEquity += Number(trade.pnl) || 0;
          dailyEquity[tradeDate] = currentEquity;
        }
        const dates = Object.keys(dailyEquity).sort();
        // Use real SPY/QQQ from resultSummary
        const rs = s.resultSummary as any;
        const spyCurveRaw: Array<{ time: number; equity: number }> = rs?.spyCurve || [];
        const qqqCurveRaw: Array<{ time: number; equity: number }> = rs?.qqqCurve || [];
        const spyByDate: Record<string, number> = {};
        const qqqByDate: Record<string, number> = {};
        for (const pt of spyCurveRaw) { spyByDate[new Date(pt.time).toISOString().split('T')[0]] = pt.equity; }
        for (const pt of qqqCurveRaw) { qqqByDate[new Date(pt.time).toISOString().split('T')[0]] = pt.equity; }
        if (spyCurveRaw.length === 0) {
          try {
            const spyCandles = await getCandlesWithCache('SPY', '1d', s.startDate, s.endDate);
            if (spyCandles.length >= 2) { const base = spyCandles[0].close; for (const c of spyCandles) spyByDate[new Date(c.time).toISOString().split('T')[0]] = initialEquity * (c.close / base); }
          } catch {}
        }
        if (qqqCurveRaw.length === 0) {
          try {
            const qqqCandles = await getCandlesWithCache('QQQ', '1d', s.startDate, s.endDate);
            if (qqqCandles.length >= 2) { const base = qqqCandles[0].close; for (const c of qqqCandles) qqqByDate[new Date(c.time).toISOString().split('T')[0]] = initialEquity * (c.close / base); }
          } catch {}
        }
        let lastSpy = initialEquity, lastQqq = initialEquity;
        const equityCurve = dates.map(date => {
          const equity = dailyEquity[date];
          if (spyByDate[date] !== undefined) lastSpy = spyByDate[date];
          if (qqqByDate[date] !== undefined) lastQqq = qqqByDate[date];
          return { time: new Date(date).getTime(), equity, spy: lastSpy, qqq: lastQqq };
        });
        return {
          id: s.id,
          name: s.name,
          strategy: s.strategy,
          strategyName: STRATEGY_INFO[s.strategy as StrategyType]?.name || s.strategy,
          symbols: (s.symbols as string[]) || [],
          symbolCount: ((s.symbols as string[]) || []).length,
          startDate: s.startDate,
          endDate: s.endDate,
          initialCapital: initialEquity,
          maxPositionPct: Number(s.maxPositionPct),
          strategyParams: s.strategyParams,
          stopLoss: (s.strategyParams as any)?.stopLossPct ?? null,
          takeProfit: (s.strategyParams as any)?.takeProfitPct ?? null,
          trailingStop: (s.strategyParams as any)?.trailingStopPct ?? null,
          status: s.status,
          totalReturnPct: Number(s.totalReturnPct) || 0,
          totalReturn: Number(s.totalReturn) || 0,
          winRate: Number(s.winRate) || 0,
          maxDrawdown: Number(s.maxDrawdown) || 0,
          sharpeRatio: Number(s.sharpeRatio) || 0,
          totalTrades: s.totalTrades || 0,
          winningTrades: s.winningTrades || 0,
          losingTrades: s.losingTrades || 0,
          benchmarkReturn: Number(s.benchmarkReturn) || 0,
          equityCurve,
          createdAt: s.createdAt,
        };
      }));
      return { sessions: comparison };
    }),

    aiAnalyze: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const sessions = await db.select().from(backtestSessions).where(eq(backtestSessions.id, input.id)).limit(1);
      if (sessions.length === 0) throw new Error("Session not found");
      if (sessions[0].userId !== ctx.user.id) throw new Error("Unauthorized");
      const session = sessions[0];
      if (session.status !== "completed") throw new Error("回测尚未完成");
      const analysis = await analyzeBacktestResult({
        strategy: session.strategy, symbols: (session.symbols as string[]) || [],
        startDate: session.startDate, endDate: session.endDate,
        totalReturnPct: Number(session.totalReturnPct) || 0,
        winRate: Number(session.winRate) || 0, maxDrawdown: Number(session.maxDrawdown) || 0,
        sharpeRatio: Number(session.sharpeRatio) || 0, totalTrades: session.totalTrades || 0,
        benchmarkReturn: Number(session.benchmarkReturn) || 0,
      });
      const analysisText = JSON.stringify(analysis);
      await db.update(backtestSessions).set({ aiAnalysis: analysisText }).where(eq(backtestSessions.id, input.id));
      return { analysis };
    }),
  }),

  dataSourcePriority: router(dataSourcePriorityRouter),
  scanHistory: router(scanHistoryRouter),
  marketCap: marketCapRouter,
  cache: router({
    status: publicProcedure.query(async () => {
      const status = await getCacheStatus();
      const warming = getCacheWarmingStatus();
      return { cacheEntries: status, warming };
    }),
    warmDaily: protectedProcedure.input(z.object({
      symbols: z.array(z.string()).optional(),
    })).mutation(async ({ input }) => {
      const symbols = input.symbols || STOCK_POOL.map(s => s.symbol);
      warmCacheForSymbols(symbols, ["1d"]).catch(err => console.error("[Cache] Warming error:", err));
      return { message: `开始缓存 ${symbols.length} 只股票的日线数据（自动重试失败项）`, total: symbols.length };
    }),
    warmingStatus: publicProcedure.query(() => getCacheWarmingStatus()),
    // Last cache run time for home page
    lastRunTime: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { lastCacheTime: null };
      try {
        const [row] = await db.select({ lastUpdated: cacheMetadata.lastUpdated })
          .from(cacheMetadata)
          .orderBy(desc(cacheMetadata.lastUpdated))
          .limit(1);
        return { lastCacheTime: row?.lastUpdated ?? null };
      } catch {
        return { lastCacheTime: null };
      }
    }),
    failedSymbols: publicProcedure
      .query(async () => {
        const db = await getDb();
        if (!db) return { failed: [], total: 0, cachedCount: 0 };
        
        try {
          // Get all cached symbols from database
          const cached = await db.select({ symbol: cacheMetadata.symbol }).from(cacheMetadata);
          const cachedSet = new Set(cached.map((c: any) => c.symbol));
          
          // Get all symbols from stock pool
          const allSymbols = STOCK_POOL.map(s => s.symbol);
          
          // Get persisted excluded symbols from DB (survives server restarts)
          const excluded = await db.select({ symbol: excludedSymbols.symbol }).from(excludedSymbols);
          const excludedSet = new Set(excluded.map((e: any) => e.symbol));
          // Also sync in-memory set from DB
          excluded.forEach((e: any) => removedFailedSymbols.add(e.symbol));
          
          // Find failed/uncached symbols (exclude both cached and excluded)
          const failed = allSymbols.filter(s => !cachedSet.has(s) && !excludedSet.has(s));
          
          // total reflects active pool size (minus excluded symbols)
          const activeTotal = allSymbols.length - excludedSet.size;
          return { 
            failed, 
            total: activeTotal, 
            cachedCount: cachedSet.size 
          };
        } catch (err) {
          console.error("[Cache] Failed to get failed symbols:", err);
          return { failed: [], total: 0, cachedCount: 0, error: "Failed to query cache status" };
        }
      }),
    removeFailedSymbol: protectedProcedure
      .input(z.object({
        symbols: z.array(z.string()).min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
        try {
          // Persist to DB so it survives server restarts
          for (const symbol of input.symbols) {
            await db.insert(excludedSymbols).values({
              userId: ctx.user.id,
              symbol,
              reason: 'user_request',
            }).onDuplicateKeyUpdate({ set: { reason: 'user_request' } });
            removedFailedSymbols.add(symbol);
          }
          console.log(`[Cache] Removed symbols from failed list: ${input.symbols.join(", ")}`);
          return { message: `已删除 ${input.symbols.length} 只股票` };
        } catch (err) {
          console.error("[Cache] Failed to remove symbols:", err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "删除失败" });
        }
      }),
    resume: protectedProcedure.query(async ({ ctx }) => {
      const { getIncompleteWarmingProgress } = await import("./db");
      const progress = await getIncompleteWarmingProgress(ctx.user.id);
      return progress;
    }),
    stats: protectedProcedure.query(async ({ ctx }) => {
      const { getWarmingStats } = await import("./db");
      const stats = await getWarmingStats(ctx.user.id);
      return stats;
    }),
    createScheduledTask: protectedProcedure
      .input(z.object({
        name: z.string(),
        description: z.string().optional(),
        sectors: z.array(z.string()).default([]),
        marketCapTiers: z.array(z.string()).default([]),
        customSymbols: z.array(z.string()).optional(),
        cronExpression: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createScheduledTask } = await import("./db");
        await createScheduledTask(
          ctx.user.id,
          input.name,
          input.sectors,
          input.marketCapTiers,
          input.cronExpression,
          input.description,
          input.customSymbols
        );
        return { success: true };
      }),
    listScheduledTasks: protectedProcedure.query(async ({ ctx }) => {
      const { getScheduledTasks } = await import("./db");
      const tasks = await getScheduledTasks(ctx.user.id);
      return tasks;
    }),
    updateScheduledTask: protectedProcedure
      .input(z.object({
        taskId: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        sectors: z.array(z.string()).optional(),
        marketCapTiers: z.array(z.string()).optional(),
        customSymbols: z.array(z.string()).optional(),
        cronExpression: z.string().optional(),
        isEnabled: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateScheduledTask, getScheduledTaskById } = await import("./db");
        const task = await getScheduledTaskById(input.taskId);
        if (!task || task.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await updateScheduledTask(input.taskId, input);
        return { success: true };
      }),
    deleteScheduledTask: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteScheduledTask, getScheduledTaskById } = await import("./db");
        const task = await getScheduledTaskById(input.taskId);
        if (!task || task.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deleteScheduledTask(input.taskId);
        return { success: true };
      }),

    // Cache metadata visualization - show coverage timeline per symbol
    metadataTimeline: publicProcedure
      .input(z.object({
        symbols: z.array(z.string()).optional(),
        limit: z.number().default(100),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { entries: [], totalSymbols: 0, coveredSymbols: 0, avgCoverageYears: 0 };
        const rows = await db.select().from(cacheMetadata)
          .orderBy(cacheMetadata.candleCount)
          .limit(input.limit);
        const allSymbols = STOCK_POOL.map(s => s.symbol);
        const coveredSet = new Set(rows.map(r => r.symbol));
        const entries = rows.map(r => ({
          symbol: r.symbol,
          timeframe: r.timeframe,
          oldestDate: r.oldestDate,
          newestDate: r.newestDate,
          candleCount: r.candleCount || 0,
          status: r.status,
          coverageYears: r.oldestDate && r.newestDate
            ? (new Date(r.newestDate).getTime() - new Date(r.oldestDate).getTime()) / (365.25 * 86400000)
            : 0,
          lastUpdated: r.lastUpdated,
        }));
        const avgCoverageYears = entries.length > 0
          ? entries.reduce((a, b) => a + b.coverageYears, 0) / entries.length
          : 0;
        return {
          entries,
          totalSymbols: allSymbols.length,
          coveredSymbols: coveredSet.size,
          avgCoverageYears: Math.round(avgCoverageYears * 10) / 10,
        };
      }),

    // Auto warm daily cache for all stale symbols
    autoWarmDaily: protectedProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const staleRows = await db.select({ symbol: cacheMetadata.symbol })
        .from(cacheMetadata)
        .where(sql`${cacheMetadata.newestDate} < ${yesterdayStr}`);
      const staleSymbols = staleRows.map(r => r.symbol);
      const cached = await db.select({ symbol: cacheMetadata.symbol }).from(cacheMetadata);
      const cachedSet = new Set(cached.map(r => r.symbol));
      const uncached = STOCK_POOL.map(s => s.symbol).filter(s => !cachedSet.has(s));
      const allToWarm = Array.from(new Set([...staleSymbols, ...uncached.slice(0, 50)]));
      warmCacheForSymbols(allToWarm, ["1d"]).catch(err => console.error("[Cache] Auto warm error:", err));
      return { message: `自动预热已启动，共 ${allToWarm.length} 只股票`, total: allToWarm.length };
      }),
  }),


  ai: router({
    getConfigs: protectedProcedure.query(async ({ ctx }) => {
      const { getAIConfigs } = await import("./db");
      return getAIConfigs(ctx.user.id);
    }),
    createConfig: protectedProcedure
      .input(z.object({
        provider: z.string(),
        apiEndpoint: z.string(),
        apiKey: z.string(),
        model: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createAIConfig } = await import("./db");
        await createAIConfig(ctx.user.id, input);
        return { success: true };
      }),
    updateConfig: protectedProcedure
      .input(z.object({
        configId: z.number(),
        apiEndpoint: z.string().optional(),
        apiKey: z.string().optional(),
        model: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getAIConfigById, updateAIConfig } = await import("./db");
        const config = await getAIConfigById(input.configId);
        if (!config || config.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await updateAIConfig(input.configId, {
          apiEndpoint: input.apiEndpoint,
          apiKey: input.apiKey,
          model: input.model,
          isActive: input.isActive,
        });
        return { success: true };
      }),
    deleteConfig: protectedProcedure
      .input(z.object({ configId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getAIConfigById, deleteAIConfig } = await import("./db");
        const config = await getAIConfigById(input.configId);
        if (!config || config.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deleteAIConfig(input.configId);
        return { success: true };
      }),
    setDefault: protectedProcedure
      .input(z.object({
        provider: z.string(),
        configId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getAIConfigById, setDefaultAIConfig } = await import("./db");
        const config = await getAIConfigById(input.configId);
        if (!config || config.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await setDefaultAIConfig(ctx.user.id, input.provider, input.configId);
        return { success: true };
      }),
    testConnection: protectedProcedure
      .input(z.object({
        provider: z.string(),
        apiEndpoint: z.string(),
        apiKey: z.string(),
        model: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const response = await fetch(`${input.apiEndpoint}/models`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${input.apiKey}`,
              "Content-Type": "application/json",
            },
          });
          
          if (!response.ok) {
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
            };
          }
          
          return {
            success: true,
            message: "连接成功",
          };
        } catch (error: any) {
          return {
            success: false,
            error: error?.message || "连接失败",
          };
        }
      }),
  }),
  datasource: router({
    getConfigs: protectedProcedure.query(async ({ ctx }) => {
      const { getCustomDataSources } = await import("./db");
      return getCustomDataSources(ctx.user.id);
    }),
    createConfig: protectedProcedure
      .input(z.object({
        name: z.string(),
        provider: z.string(),
        apiEndpoint: z.string().optional(),
        apiKey: z.string().optional(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createCustomDataSource } = await import("./db");
        await createCustomDataSource(ctx.user.id, input);
        return { success: true };
      }),
    updateConfig: protectedProcedure
      .input(z.object({
        sourceId: z.number(),
        name: z.string().optional(),
        provider: z.string().optional(),
        apiEndpoint: z.string().optional(),
        apiKey: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getCustomDataSourceById, updateCustomDataSource } = await import("./db");
        const source = await getCustomDataSourceById(input.sourceId);
        if (!source || source.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await updateCustomDataSource(input.sourceId, input);
        return { success: true };
      }),
    deleteConfig: protectedProcedure
      .input(z.object({ sourceId: z.number(), sourceName: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { getCustomDataSourceById, deleteCustomDataSource } = await import("./db");
        
        // 删除内置数据源的配置（从 dataSourceHealth 表中删除）
        if (input.sourceId === 0 && input.sourceName) {
          const db = await getDb();
          if (db) {
            await db.delete(dataSourceHealth).where(
              eq(dataSourceHealth.source, input.sourceName)
            );
          }
          return { success: true };
        }
        
        // 删除自定义数据源
        const source = await getCustomDataSourceById(input.sourceId);
        if (!source || source.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deleteCustomDataSource(input.sourceId);
        return { success: true };
      }),
  }),
  scan: router({
    // Get today's top buy signals (from DB cache)
    topSignals: publicProcedure
      .input(z.object({
        strategy: z.enum(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"]).optional(),
        limit: z.number().min(1).max(50).default(10),
      }))
      .query(async ({ input }) => {
        return getTodayTopSignals(input.strategy as StrategySignalType | undefined, input.limit);
      }),

    // Get today's scan summary (how many signals per strategy)
    todaySummary: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { date: "", totalBuy: 0, totalSell: 0, byStrategy: {}, isYesterdayData: false };
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      let rows = await db.select().from(scanResults).where(eq(scanResults.scanDate, todayStr));
      let dateStr = todayStr;
      let isYesterdayData = false;
      
      // If today has no data, fallback to yesterday
      if (rows.length === 0) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        rows = await db.select().from(scanResults).where(eq(scanResults.scanDate, yesterdayStr));
        dateStr = yesterdayStr;
        isYesterdayData = true;
      }
      
      const byStrategy: Record<string, { buy: number; sell: number; hold: number }> = {};
      let totalBuy = 0, totalSell = 0;
      for (const r of rows) {
        if (!byStrategy[r.strategy]) byStrategy[r.strategy] = { buy: 0, sell: 0, hold: 0 };
        byStrategy[r.strategy][r.signalType as "buy" | "sell" | "hold"]++;
        if (r.signalType === "buy") totalBuy++;
        else if (r.signalType === "sell") totalSell++;
      }
      return { date: dateStr, totalBuy, totalSell, byStrategy, isYesterdayData };
    }),

    // Get last scan and cache run times for home page display
    lastRunTimes: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { lastScanTime: null, lastCacheTime: null, lastScanLog: null, lastCacheLog: null };
      try {
        const [scanRow] = await db.select({ createdAt: scanResults.createdAt })
          .from(scanResults)
          .orderBy(desc(scanResults.createdAt))
          .limit(1);
        const [cacheRow] = await db.select({ lastUpdated: cacheMetadata.lastUpdated })
          .from(cacheMetadata)
          .orderBy(desc(cacheMetadata.lastUpdated))
          .limit(1);
        // Also get system task log entries for display
        const [scanLog] = await db.execute(
          `SELECT executedAt, success, message FROM system_task_log WHERE taskName = 'daily-scan' ORDER BY executedAt DESC LIMIT 1`
        ) as any;
        const [cacheLog] = await db.execute(
          `SELECT executedAt, success, message FROM system_task_log WHERE taskName = 'daily-cache' ORDER BY executedAt DESC LIMIT 1`
        ) as any;
        return {
          lastScanTime: scanRow?.createdAt ?? null,
          lastCacheTime: cacheRow?.lastUpdated ?? null,
          lastScanLog: scanLog?.[0] ?? null,
          lastCacheLog: cacheLog?.[0] ?? null,
        };
      } catch {
        return { lastScanTime: null, lastCacheTime: null, lastScanLog: null, lastCacheLog: null };
      }
    }),

    // Full scan - real-time scan with progress tracking
    startScan: protectedProcedure
      .input(z.object({
        strategies: z.array(z.enum(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"])).default(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze"]),
        sectors: z.array(z.string()).optional(),
        marketCapTiers: z.array(z.string()).optional(),
        minScore: z.number().min(0).max(100).default(30),
        signalType: z.enum(["buy", "sell", "hold"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        // Create a persistent job record
        const [jobRow] = await db.execute(sql`
          INSERT INTO scan_jobs (userId, status, progress, total, strategies, message)
          VALUES (${ctx.user!.id}, 'running', 0, 793, ${JSON.stringify(input.strategies)}, '扫描启动中...')
        `) as any;
        const jobId: number = (jobRow as any).insertId;
        const { getIO } = await import("./wsProgress");
        const options: ScanOptions = {
          strategies: input.strategies as StrategySignalType[],
          sectors: input.sectors as any,
          marketCapTiers: input.marketCapTiers as any,
          minScore: input.minScore,
          signalType: input.signalType as any,
        };
        // Run scan in background with progress updates
        scanStockPool(options, async (done, total, symbol) => {
          if (done % 10 === 0 || done === total) {
            await db.execute(sql`UPDATE scan_jobs SET progress=${done}, total=${total}, currentSymbol=${symbol}, message=${'扫描中 (' + done + '/' + total + ')...'} WHERE id=${jobId}`).catch(() => {});
          }
          getIO()?.emit("scan:progress", { jobId, done, total, percent: Math.round((done / total) * 100), currentSymbol: symbol });
        }).then(async signals => {
          await saveScanResults(signals).catch(console.error);
          await db.execute(sql`UPDATE scan_jobs SET status='done', progress=${signals.length}, message=${"扫描完成，共 " + signals.length + " 个信号"}, resultCount=${signals.length}, completedAt=NOW() WHERE id=${jobId}`).catch(() => {});
          getIO()?.emit("scan:progress", { jobId, done: 793, total: 793, percent: 100, status: "done", resultCount: signals.length });
        }).catch(async (err) => {
          await db.execute(sql`UPDATE scan_jobs SET status='error', message=${String(err)} WHERE id=${jobId}`).catch(() => {});
        });
        return { started: true, jobId, message: "扫描已启动，可离开页面，结果将自动保存" };
      }),
    // Get scan job progress (polling)
    getScanJobProgress: publicProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const rows = await db.execute(sql`SELECT * FROM scan_jobs WHERE id=${input.jobId} LIMIT 1`) as any;
        const row = (rows[0] as any[])?.[0];
        if (!row) return null;
        return {
          id: row.id as number, status: row.status as string,
          progress: row.progress as number, total: row.total as number,
          percent: Math.round(((row.progress as number) / Math.max(row.total as number, 1)) * 100),
          currentSymbol: row.currentSymbol as string | null,
          message: row.message as string | null,
          resultCount: row.resultCount as number,
          createdAt: row.createdAt, completedAt: row.completedAt,
        };
      }),
    // Get latest scan job for current user
    getLatestScanJob: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.execute(sql`SELECT * FROM scan_jobs WHERE userId=${ctx.user!.id} ORDER BY createdAt DESC LIMIT 1`) as any;
      const row = (rows[0] as any[])?.[0];
      if (!row) return null;
      return {
        id: row.id as number, status: row.status as string,
        progress: row.progress as number, total: row.total as number,
        percent: Math.round(((row.progress as number) / Math.max(row.total as number, 1)) * 100),
        currentSymbol: row.currentSymbol as string | null,
        message: row.message as string | null,
        resultCount: row.resultCount as number,
        createdAt: row.createdAt, completedAt: row.completedAt,
      };
    }),

    // Get scan results with filters
    getResults: publicProcedure
      .input(z.object({
        strategies: z.array(z.enum(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"])).optional(),
        sectors: z.array(z.string()).optional(),
        marketCapTiers: z.array(z.string()).optional(),
        signalType: z.enum(["buy", "sell", "hold", "all"]).default("buy"),
        minScore: z.number().default(0),
        limit: z.number().default(200),
        page: z.number().default(1),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { results: [], total: 0, date: "", isYesterdayData: false };
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        let rows = await db.select().from(scanResults)
          .where(eq(scanResults.scanDate, todayStr))
          .orderBy(desc(scanResults.score))
          .limit(2000);
        let dateStr = todayStr;
        let isYesterdayData = false;
        
        // If today has no data, fallback to yesterday
        if (rows.length === 0) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
          rows = await db.select().from(scanResults)
            .where(eq(scanResults.scanDate, yesterdayStr))
            .orderBy(desc(scanResults.score))
            .limit(2000);
          dateStr = yesterdayStr;
          isYesterdayData = true;
        }
        // Filter in memory for flexibility
        if (input.signalType !== "all") rows = rows.filter(r => r.signalType === input.signalType);
        if (input.strategies && input.strategies.length > 0) rows = rows.filter(r => input.strategies!.includes(r.strategy as any));
        if (input.minScore > 0) rows = rows.filter(r => r.score >= input.minScore);
        // Sector/marketCap filter
        if ((input.sectors && input.sectors.length > 0) || (input.marketCapTiers && input.marketCapTiers.length > 0)) {
          const { getMarketCapTier } = await import("@shared/stockPool");
          rows = rows.filter(r => {
            const stock = STOCK_POOL.find(s => s.symbol === r.symbol);
            if (!stock) return false;
            if (input.sectors && input.sectors.length > 0 && !stock.sectors.some(sec => input.sectors!.includes(sec))) return false;
            if (input.marketCapTiers && input.marketCapTiers.length > 0 && !input.marketCapTiers.includes(getMarketCapTier(stock.marketCap))) return false;
            return true;
          });
        }
        const total = rows.length;
        const offset = (input.page - 1) * input.limit;
        const paged = rows.slice(offset, offset + input.limit);
        const results = paged.map(r => {
          const stock = STOCK_POOL.find(s => s.symbol === r.symbol);
          return {
            ...r,
            name: stock?.name || r.symbol,
            sectors: stock?.sectors || [],
            marketCap: stock?.marketCap || 0,
            signals: r.signals ? JSON.parse(r.signals) : [],
          };
        });
        return { results, total, date: dateStr, isYesterdayData };
      }),

    // Quick scan for a single stock across all strategies (real-time)
    quickScanSymbol: publicProcedure
      .input(z.object({
        symbol: z.string().min(1).max(10),
        strategies: z.array(z.enum(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"])).default(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze"]),
      }))
      .query(async ({ input }) => {
        const today = new Date();
        const endDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const startDate = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
        const candles = await getCandlesWithCache(input.symbol, "1d", startDate, endDate);
        if (candles.length < 30) return [];
        return input.strategies.map(strategy => analyzeStock(input.symbol, candles, strategy as StrategySignalType));
      }),
  }),

  watchlist: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(watchlist).where(eq(watchlist.userId, ctx.user.id)).orderBy(watchlist.createdAt);
    }),
    add: protectedProcedure.input(z.object({
      symbol: z.string().min(1).max(20),
      name: z.string().optional(),
      alertThreshold: z.number().min(0).max(100).default(80),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库不可用' });
      try {
        await db.insert(watchlist).values({
          userId: ctx.user.id,
          symbol: input.symbol.toUpperCase(),
          name: input.name || input.symbol.toUpperCase(),
          alertThreshold: input.alertThreshold,
        });
        return { success: true };
      } catch (e: any) {
        if (e?.code === 'ER_DUP_ENTRY') throw new TRPCError({ code: 'CONFLICT', message: '该股票已在自选列表' });
        throw e;
      }
    }),
    remove: protectedProcedure.input(z.object({ symbol: z.string() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库不可用' });
      const { and } = await import('drizzle-orm');
      await db.delete(watchlist).where(
        and(eq(watchlist.userId, ctx.user.id), eq(watchlist.symbol, input.symbol.toUpperCase()))
      );
      return { success: true };
    }),
    updateThreshold: protectedProcedure.input(z.object({
      symbol: z.string(),
      alertThreshold: z.number().min(0).max(100),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库不可用' });
      const { and } = await import('drizzle-orm');
      await db.update(watchlist)
        .set({ alertThreshold: input.alertThreshold })
        .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.symbol, input.symbol.toUpperCase())));
      return { success: true };
    }),
    // Get latest price for watchlist symbols using cached candles
    prices: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const items = await db.select().from(watchlist).where(eq(watchlist.userId, ctx.user.id));
      if (items.length === 0) return [];
      const results = await Promise.all(items.map(async item => {
        try {
          const candles = await getCandlesWithCache(item.symbol, '1d');
          const last = candles[candles.length - 1];
          const prev = candles.length >= 2 ? candles[candles.length - 2] : null;
          const price = last?.close ?? 0;
          const change = prev ? ((last.close - prev.close) / prev.close * 100) : 0;
          return { symbol: item.symbol, name: item.name, price, change, alertThreshold: item.alertThreshold };
        } catch {
          return { symbol: item.symbol, name: item.name, price: 0, change: 0, alertThreshold: item.alertThreshold };
        }
      }));
      return results;
    }),
  }),

  health: router({
    sources: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(dataSourceHealth).orderBy(dataSourceHealth.source);
    }),
    geminiStatus: publicProcedure.query(async () => {
      const results = await testGeminiConnection().catch(() => ({ gemini: false, openai: false }));
      return {
        gemini: {
          connected: results.gemini,
          model: ENV.geminiModel,
          baseUrl: ENV.geminiBaseUrl,
        },
        openai: {
          connected: results.openai,
          model: ENV.openaiModel,
          baseUrl: ENV.openaiBaseUrl,
        },
        // Legacy field for backward compat
        connected: results.gemini || results.openai,
        activeProvider: results.gemini ? "gemini" : results.openai ? "openai" : "none",
      };
    }),
    testSource: publicProcedure
      .input(z.object({
        source: z.enum(["alpaca", "stooq", "yahoo", "tiingo", "finnhub", "alphavantage", "polygon", "twelvedata", "marketstack"]),
        symbols: z.array(z.string()).default(["AAPL"]),
      }))
      .mutation(async ({ input }) => {
        const result = await testDataSource(input.source as DataSource, input.symbols);
        return result;
      }),
  }),
});

export type AppRouter = typeof appRouter;

/**
 * Scheduled task handler for daily scan.
 * Called by the Manus scheduled task agent via POST /api/scheduled/daily-scan
 * Requires user-level auth cookie (role=user is sufficient).
 */
async function logSystemTask(taskName: string, success: boolean, message: string, stats: any) {
  try {
    const db = await getDb();
    if (!db) return;
    const successVal = success ? 1 : 0;
    const statsJson = JSON.stringify(stats);
    await db.execute(
      sql`INSERT INTO system_task_log (taskName, executedAt, success, message, stats) VALUES (${taskName}, NOW(), ${successVal}, ${message}, ${statsJson})`
    );
  } catch (e) {
    console.error("[TaskLog] Failed to log:", e);
  }
}

export async function handleDailyScanScheduled(): Promise<{ success: boolean; message: string; stats: any }> {
  const strategies: StrategySignalType[] = ["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze"];
  const options: ScanOptions = { strategies, minScore: 40 };
  try {
    const signals = await scanStockPool(options);
    await saveScanResults(signals);
    const buySignals = signals.filter(s => s.signalType === "buy");
    const byStrategy: Record<string, number> = {};
    for (const s of buySignals) {
      byStrategy[s.strategy] = (byStrategy[s.strategy] || 0) + 1;
    }
    const strategyLines = Object.entries(byStrategy)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v} 只`)
      .join("\n");
    // Get top 5 overall
    const top5 = buySignals.sort((a, b) => b.score - a.score).slice(0, 5);
    const top5Lines = top5.map(s => `  ${s.symbol}(${s.strategy}) 分数:${s.score}`).join("\n");
    const result = {
      success: true,
      message: `扫描完成，共 ${buySignals.length} 个买入信号已保存`,
      stats: { totalBuy: buySignals.length, byStrategy, top5: top5.map(s => ({ symbol: s.symbol, strategy: s.strategy, score: s.score })) },
    };
    await logSystemTask("daily-scan", true, result.message, result.stats);
    await notifyOwner({
      title: `📊 今日量化信号扫描完成 - ${new Date().toLocaleDateString("zh-CN")}`,
      content: `扫描完成！共发现 ${buySignals.length} 个买入信号。\n\n各策略信号数量：\n${strategyLines}\n\n今日TOP5：\n${top5Lines}`,
    }).catch(e => console.error("[Notify] Failed:", e));
    return result;
  } catch (err: any) {
    const msg = err.message || "扫描失败";
    await logSystemTask("daily-scan", false, msg, {});
    return { success: false, message: msg, stats: {} };
  }
}

/**
 * Scheduled task handler for daily K-line cache warming.
 * Called by the Manus scheduled task agent via POST /api/scheduled/daily-cache
 * Runs at 05:00 US Eastern time (UTC 09:00) on weekdays.
 */
export async function handleDailyCacheScheduled(): Promise<{ success: boolean; message: string; stats: any }> {
  const allSymbols = STOCK_POOL.map(s => s.symbol);
  try {
    // Warm all symbols with 1d timeframe
    warmCacheForSymbols(allSymbols, ["1d"]).catch(err =>
      console.error("[DailyCache] Background warming error:", err)
    );
    const result = {
      success: true,
      message: `K线缓存预热已启动，共 ${allSymbols.length} 只股票`,
      stats: { total: allSymbols.length },
    };
    await logSystemTask("daily-cache", true, result.message, result.stats);
    await notifyOwner({
      title: `📦 K线缓存预热已启动 - ${new Date().toLocaleDateString("zh-CN")}`,
      content: `已开始预热 ${allSymbols.length} 只股票的日线数据，将在后台自动完成。`,
    }).catch(e => console.error("[Notify] Failed:", e));
    return result;
  } catch (err: any) {
    const msg = err.message || "缓存预热启动失败";
    await logSystemTask("daily-cache", false, msg, {});
    return { success: false, message: msg, stats: {} };
  }
}


/**
 * Scheduled task handler for daily market cap data update.
 * Called by the Manus scheduled task agent via POST /api/scheduled/market-cap-update
 * Runs at 06:00 UTC (14:00 Beijing time) daily.
 */
export async function handleMarketCapScheduledUpdate(): Promise<{ success: boolean; message: string; stats: any }> {
  const { handleMarketCapScheduledUpdate: updateMarketCap } = await import("./routers/scheduledMarketCapUpdate");
  return updateMarketCap();
}
