/**
 * Backtest Engine v2
 * 6 Strategies: Standard, Aggressive, Ladder+CD Combo, Mean Reversion, MACD Volume, Bollinger Squeeze
 * Features: Strategy params, stop loss/take profit, trailing stops, max holding days
 */
import type { Candle, Timeframe } from "./marketData";
import {
  calculateMACD, calculateLadder, calculateCDSignals, calculateRSI,
  calculateBollingerBands, calculateATR,
  type CDSignal, type LadderLevel
} from "./indicators";
import { calculateTradeFees } from "./tigerTradeFees";
import { getCandlesWithCache } from "./cacheManager";
import { getDb } from "./db";
import { backtestSessions, backtestTrades, cacheMetadata } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

export type StrategyType = "standard" | "aggressive" | "ladder_cd_combo" | "mean_reversion" | "macd_volume" | "bollinger_squeeze" | "vamr" | "ravts" | "rsi_reversal" | "macd_divergence";

export interface StrategyParams {
  // Common params
  stopLossPct?: number;       // e.g. 0.08 = 8%
  takeProfitPct?: number;     // e.g. 0.15 = 15%
  trailingStopPct?: number;   // e.g. 0.05 = 5% from peak
  maxHoldingDays?: number;    // 0 = unlimited
  // Standard strategy
  cdScoreThreshold?: number;  // min CD score to trigger buy
  ladderConfirm?: boolean;    // require ladder confirmation
  secondTranchePct?: number;  // 2nd buy tranche size
  // Aggressive strategy
  minCDStrength?: string;     // "weak" | "medium" | "strong"
  // Ladder+CD Combo
  requireMACDAccel?: boolean; // require MACD acceleration
  minLadderGap?: number;      // min gap between blue and yellow
  // Mean Reversion
  rsiOversold?: number;       // RSI oversold threshold (default 30)
  rsiOverbought?: number;     // RSI overbought threshold (default 70)
  meanPeriod?: number;        // SMA period for mean
  // MACD Volume
  volumeMultiplier?: number;  // volume spike multiplier (default 1.5)
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  // Bollinger Squeeze
  bbPeriod?: number;          // Bollinger period (default 20)
  bbMultiplier?: number;      // Bollinger multiplier (default 2)
  squeezeThreshold?: number;  // bandwidth threshold for squeeze
  // VAMR (Volatility Adjusted Momentum Reversal)
  volatilityPeriod?: number;  // ATR period for volatility (default 14)
  momentumPeriod?: number;    // momentum lookback period (default 20)
  rsi4Threshold?: number;     // RSI(4) oversold threshold (default 30)
  // RAVTS (Regime Adjusted Volatility Trend Score)
  emaPeriod?: number;         // EMA period for trend (default 20)
  volumeConfirmPct?: number;  // volume confirmation multiplier (default 1.2)
  // RSI Reversal
  rsiPeriod?: number;         // RSI period (default 14)
  rsiReversal?: number;       // RSI reversal threshold (default 35)
  // MACD Divergence
  macdDivergencePeriod?: number; // lookback period for divergence (default 5)
}

export const STRATEGY_DEFAULTS: Record<StrategyType, StrategyParams> = {
  standard: {
    stopLossPct: 0.08, takeProfitPct: 0.20, trailingStopPct: 0,
    maxHoldingDays: 0, cdScoreThreshold: 0, ladderConfirm: true, secondTranchePct: 0.5,
  },
  aggressive: {
    stopLossPct: 0.06, takeProfitPct: 0.12, trailingStopPct: 0.04,
    maxHoldingDays: 30, minCDStrength: "weak",
  },
  ladder_cd_combo: {
    stopLossPct: 0.07, takeProfitPct: 0.15, trailingStopPct: 0.05,
    maxHoldingDays: 0, requireMACDAccel: true, minLadderGap: 0,
  },
  mean_reversion: {
    stopLossPct: 0.06, takeProfitPct: 0.10, trailingStopPct: 0,
    maxHoldingDays: 20, rsiOversold: 30, rsiOverbought: 70, meanPeriod: 20,
  },
  macd_volume: {
    stopLossPct: 0.07, takeProfitPct: 0.15, trailingStopPct: 0.05,
    maxHoldingDays: 0, volumeMultiplier: 1.5, macdFast: 12, macdSlow: 26, macdSignal: 9,
  },
  bollinger_squeeze: {
    stopLossPct: 0.06, takeProfitPct: 0.12, trailingStopPct: 0.04,
    maxHoldingDays: 15, bbPeriod: 20, bbMultiplier: 2, squeezeThreshold: 0.04,
  },
  vamr: {
    stopLossPct: 0.06, takeProfitPct: 0.18, trailingStopPct: 0.05,
    maxHoldingDays: 30, volatilityPeriod: 14, momentumPeriod: 20, rsi4Threshold: 30,
  },
  ravts: {
    stopLossPct: 0.07, takeProfitPct: 0.20, trailingStopPct: 0.06,
    maxHoldingDays: 0, emaPeriod: 20, volumeConfirmPct: 1.2,
  },
  rsi_reversal: {
    stopLossPct: 0.05, takeProfitPct: 0.15, trailingStopPct: 0.04,
    maxHoldingDays: 20, rsiPeriod: 14, rsiReversal: 35,
  },
  macd_divergence: {
    stopLossPct: 0.06, takeProfitPct: 0.16, trailingStopPct: 0.05,
    maxHoldingDays: 25, macdDivergencePeriod: 5, macdFast: 12, macdSlow: 26, macdSignal: 9,
  },
};

export const STRATEGY_INFO: Record<StrategyType, { name: string; description: string }> = {
  standard: {
    name: "标准策略 (4321)",
    description: "基于CD抄底信号的分批建仓策略。第一次买入在CD金叉信号出现时，第二次在价格突破蓝梯上轨时加仓。卖出条件包括CD死叉信号、跌破黄梯下轨或触发止损。适合中长期趋势跟踪，风险适中。",
  },
  aggressive: {
    name: "激进策略",
    description: "在CD买入信号出现且价格站上蓝梯中轨时立即全仓买入。卖出条件为CD卖出信号、跌破蓝梯下轨或触发止损。交易频率较高，适合短线操作，风险较高但潜在收益也更大。",
  },
  ladder_cd_combo: {
    name: "组合策略 (黄蓝梯子+CD)",
    description: "多重确认的高胜率策略。买入需同时满足：CD买入信号、蓝梯在黄梯上方（趋势确认）、价格在蓝梯中轨上方（动量确认）、MACD柱体加速。卖出有追踪止损、止盈、趋势反转等多重保护。设计目标是胜率>50%且跑赢大盘。",
  },
  mean_reversion: {
    name: "均值回归策略",
    description: "利用RSI超卖信号和布林带下轨支撑进行抄底。当RSI低于超卖阈值且价格触及布林带下轨时买入，当RSI高于超买阈值或价格触及布林带上轨时卖出。适合震荡市场，持仓周期较短。结合黄蓝梯子趋势过滤，避免在下跌趋势中抄底。",
  },
  macd_volume: {
    name: "MACD量价策略",
    description: "结合MACD金叉和成交量放大信号的趋势跟踪策略。买入条件：MACD金叉 + 成交量大于N日均量的指定倍数 + 价格在蓝梯上方。量价齐升确认趋势启动，配合追踪止损锁定利润。适合捕捉趋势启动点。",
  },
  bollinger_squeeze: {
    name: "布林带收缩突破策略",
    description: "利用布林带收缩（带宽缩窄）识别即将爆发的行情。当布林带宽度低于阈值（收缩期）后价格向上突破中轨时买入，配合CD指标确认方向。适合捕捉盘整后的突破行情，持仓周期较短，胜率较高。",
  },
  vamr: {
    name: "VAMR (波动率调整动量反转)",
    description: "结合波动率、动量和RSI的高胜率反转策略。QQQ大盘过滤 + RS90动量选股 + RSI(4)超卖买入 + ATR动态止损。适合捕捉超卖反弹，胜率较高。",
  },
  ravts: {
    name: "RAVTS (市场状态调整趋势)",
    description: "市场状态调整的趋势跟踪策略。SPY大盘过滤 + EMA斜率趋势 + 量能确认 + ATR动态止损止盈。根据市场状态动态调整参数，适合趋势行情。",
  },
  rsi_reversal: {
    name: "RSI反转策略",
    description: "基于RSI指标的反转策略。当RSI低于设定阈值（超卖）时买入，高于设定阈值（超买）时卖出。适合震荡市场，持仓周期短，胜率较高。",
  },
  macd_divergence: {
    name: "MACD背离策略",
    description: "利用MACD指标背离识别趋势反转的策略。当价格创新高但MACD未创新高时识别看跌背离，反之识别看涨背离。配合动态止损锁定利润。",
  },
};

export interface BacktestConfig {
  sessionId: number;
  symbols: string[];
  startDate: string;
  endDate: string;
  strategy: StrategyType;
  strategyParams?: StrategyParams;
  initialCapital: number;
  maxPositionPct: number;
}

interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  entryTime: number;
  entryReason: string;
  peakPrice: number;
  entryDay: number; // index in candles array
}

interface TradeRecord {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  totalAmount: number;
  fee: number;
  commissionFee?: number;
  platformFee?: number;
  reason: string;
  signalType: string;
  tradeTime: number;
  pnl: number;
  pnlPct: number;
}

export interface BacktestResult {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  benchmarkReturn: number;
  trades: TradeRecord[];
  equityCurve: Array<{ time: number; equity: number }>;
}

// ============================================================
// Common exit check
// ============================================================
function checkCommonExits(
  pos: Position, candle: Candle, dayIndex: number, params: StrategyParams
): { shouldSell: boolean; reason: string; signalType: string } | null {
  const pnlPct = (candle.close - pos.avgPrice) / pos.avgPrice;

  // Hard stop loss: null/undefined = 不限（不设硬性止损）。只有明确设置且>0时才触发
  if (params.stopLossPct != null && params.stopLossPct > 0 && pnlPct < -params.stopLossPct) {
    return { shouldSell: true, reason: `止损-${(params.stopLossPct * 100).toFixed(1)}%`, signalType: "stop_loss" };
  }

  // Take profit: null/undefined = 不限（不设硬性止盈）。只有明确设置且>0时才触发
  if (params.takeProfitPct != null && params.takeProfitPct > 0 && pnlPct >= params.takeProfitPct) {
    return { shouldSell: true, reason: `止盈+${(pnlPct * 100).toFixed(1)}%`, signalType: "take_profit" };
  }

  // Trailing stop: null/undefined = 不限（不设移动止损）。只有明确设置且>0时才触发
  if (params.trailingStopPct != null && params.trailingStopPct > 0 && pos.peakPrice > 0) {
    if (candle.high > pos.peakPrice) pos.peakPrice = candle.high;
    const fromPeak = (candle.close - pos.peakPrice) / pos.peakPrice;
    if (fromPeak < -params.trailingStopPct && pnlPct > 0.01) {
      return { shouldSell: true, reason: `追踪止损(峰値回撤${(fromPeak * 100).toFixed(1)}%)`, signalType: "trailing_stop" };
    }
  }

  // Max holding days
  if (params.maxHoldingDays && params.maxHoldingDays > 0) {
    const holdingDays = dayIndex - pos.entryDay;
    if (holdingDays >= params.maxHoldingDays) {
      return { shouldSell: true, reason: `持仓${holdingDays}天到期`, signalType: "max_holding" };
    }
  }

  return null;
}

function makeSellTrade(pos: Position, candle: Candle, reason: string, signalType: string): TradeRecord {
  const fees = calculateTradeFees(pos.quantity, candle.close);
  const pnl = (candle.close - pos.avgPrice) * pos.quantity - fees.totalFee;
  const pnlPct = (candle.close - pos.avgPrice) / pos.avgPrice;
  return {
    symbol: pos.symbol, side: "sell", quantity: pos.quantity, price: candle.close,
    totalAmount: pos.quantity * candle.close, fee: fees.totalFee,
    commissionFee: fees.commission, platformFee: fees.platformFee,
    reason, signalType, tradeTime: candle.time, pnl, pnlPct,
  };
}

function makeBuyTrade(symbol: string, quantity: number, price: number, reason: string, signalType: string, time: number): TradeRecord {
  const fees = calculateTradeFees(quantity, price);
  return {
    symbol, side: "buy", quantity, price,
    totalAmount: quantity * price, fee: fees.totalFee,
    commissionFee: fees.commission, platformFee: fees.platformFee,
    reason, signalType, tradeTime: time, pnl: 0, pnlPct: 0,
  };
}

// ============================================================
// Core engine
// ============================================================
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const db = await getDb();
  const backtestStartTime = Date.now();
  // 增加总超时：每个股票最多 60 秒，793 个股票最大需要 ~13 分钟（并发 10 个） + 回测计算
  const BACKTEST_TIMEOUT = 30 * 60 * 1000; // 30 minutes total timeout
  
  if (db) {
    await db.update(backtestSessions).set({ status: "running", progress: 0, progressMessage: "初始化回测..." })
      .where(eq(backtestSessions.id, config.sessionId));
  }
  
  const checkTimeout = () => {
    if (Date.now() - backtestStartTime > BACKTEST_TIMEOUT) {
      throw new Error(`回测超时（超过 ${BACKTEST_TIMEOUT / 1000} 秒）`);
    }
  };

  const params = { ...STRATEGY_DEFAULTS[config.strategy], ...(config.strategyParams || {}) };
  const allTrades: TradeRecord[] = [];
  const equityCurve: Array<{ time: number; equity: number }> = [];
  let capital = config.initialCapital;
  const positions: Map<string, Position> = new Map();
  let peakCapital = capital;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];
  let prevCapital = capital;

  try {
    // Fetch benchmark (SPY + QQQ)
    let benchmarkReturn = 0;
    let spyCurve: Array<{ time: number; equity: number }> = [];
    let qqqCurve: Array<{ time: number; equity: number }> = [];
    try {
      const spyCandles = await getCandlesWithCache("SPY", "1d", config.startDate, config.endDate);
      if (spyCandles.length >= 2) {
        benchmarkReturn = (spyCandles[spyCandles.length - 1].close - spyCandles[0].close) / spyCandles[0].close;
        const spyBase = spyCandles[0].close;
        spyCurve = spyCandles.map(c => ({ time: c.time, equity: config.initialCapital * (c.close / spyBase) }));
      }
    } catch { /* ignore */ }
    try {
      const qqqCandles = await getCandlesWithCache("QQQ", "1d", config.startDate, config.endDate);
      if (qqqCandles.length >= 2) {
        const qqqBase = qqqCandles[0].close;
        qqqCurve = qqqCandles.map(c => ({ time: c.time, equity: config.initialCapital * (c.close / qqqBase) }));
      }
    } catch { /* ignore */ }

    const totalSymbols = config.symbols.length;
    
    // Phase 0: Check which symbols have cache
    console.log(`[Backtest] Checking cache status for ${totalSymbols} symbols...`);
    const cachedSymbols = new Set<string>();
    try {
      if (db) {
        const cached = await db.select({ symbol: cacheMetadata.symbol }).from(cacheMetadata).where(
          sql`${cacheMetadata.symbol} IN (${config.symbols.map(s => `'${s}'`).join(',')})`
        );
        cached.forEach(c => cachedSymbols.add(c.symbol));
      }
    } catch (err) {
      console.warn(`[Backtest] Failed to check cache status:`, err);
    }
    console.log(`[Backtest] Cache status: ${cachedSymbols.size}/${totalSymbols} symbols have cache`);
    
    // Phase 1: Stream fetch all candles (with 10 parallel requests max)
    console.log(`[Backtest] Starting streaming data fetch for ${totalSymbols} symbols...`);
    const CONCURRENT_LIMIT = 10;
    const candleMap = new Map<string, Candle[]>();
    const fetchErrors = new Map<string, string>();
    let loadedCount = 0;
    let cacheHitCount = 0;
    let apiPullCount = 0;
    
    // Create a queue for concurrent processing
    const queue = [...config.symbols];
    const activePromises = new Set<Promise<void>>();
    
    while (queue.length > 0 || activePromises.size > 0) {
      checkTimeout();
      
      // Fill up to CONCURRENT_LIMIT concurrent requests
      while (queue.length > 0 && activePromises.size < CONCURRENT_LIMIT) {
        const symbol = queue.shift()!;
        
        const fetchPromise = (async () => {
          try {
            const startTime = Date.now();
            const candles = await getCandlesWithCache(symbol, "1d", config.startDate, config.endDate);
            const duration = Date.now() - startTime;
            const isCached = duration < 500; // Fast = from cache
            if (isCached) cacheHitCount++; else apiPullCount++;
            console.log(`[Backtest] ${symbol}: ${candles.length} candles in ${duration}ms (cached=${isCached})`);
            
            if (candles.length >= 100) {
              candleMap.set(symbol, candles);
            } else {
              fetchErrors.set(symbol, `only ${candles.length} candles`);
            }
          } catch (err) {
            fetchErrors.set(symbol, err instanceof Error ? err.message : String(err));
            console.error(`[Backtest] Failed to fetch ${symbol}:`, err);
          } finally {
            loadedCount++;
            const progress = Math.round((loadedCount / totalSymbols) * 50);
            if (db) {
              await db.update(backtestSessions).set({
                progress, progressMessage: `加载数据 (${loadedCount}/${totalSymbols}) · 缓存命中 ${loadedCount > 0 ? Math.round(cacheHitCount / loadedCount * 100) : 0}%`,
              }).where(eq(backtestSessions.id, config.sessionId));
            }
          }
        })();
        
        activePromises.add(fetchPromise);
        fetchPromise.finally(() => activePromises.delete(fetchPromise));
      }
      
      // Wait for at least one to complete before continuing
      if (activePromises.size > 0) {
        await Promise.race(activePromises);
      }
    }
    
    console.log(`[Backtest] Data fetch complete: ${candleMap.size} symbols loaded, ${fetchErrors.size} failed`);
    if (fetchErrors.size > 0) {
      const failedList = Array.from(fetchErrors.keys()).slice(0, 20).join(', ');
      console.log(`[Backtest] Failed symbols: ${failedList}${fetchErrors.size > 20 ? '...' : ''}`);
    }
    
    // Phase 2: Process strategies sequentially on loaded data
    let processedSymbols = 0;
    for (const symbol of config.symbols) {
      checkTimeout();
      processedSymbols++;
      const progress = 50 + Math.round((processedSymbols / totalSymbols) * 50); // Second 50% for strategy
      if (db && processedSymbols % 5 === 0) {
        await db.update(backtestSessions).set({
          progress, progressMessage: `策略回测 ${symbol} (${processedSymbols}/${totalSymbols})`,
        }).where(eq(backtestSessions.id, config.sessionId));
      }

      const dailyCandles = candleMap.get(symbol);
      if (!dailyCandles) {
        console.log(`[Backtest] Skipping ${symbol}: ${fetchErrors.get(symbol) || 'no data'}`);
        continue;
      }

      try {
        const symbolTrades = runStrategyOnCandles(symbol, dailyCandles, config.strategy, capital, config.maxPositionPct, positions, params);

        for (const trade of symbolTrades) {
          allTrades.push(trade);
          if (trade.side === "buy") {
            capital -= trade.totalAmount + trade.fee;
          } else {
            capital += trade.totalAmount - trade.fee;
          }

          const posValue = Array.from(positions.values()).reduce((sum, p) => sum + p.quantity * p.avgPrice, 0);
          const totalEquity = capital + posValue;
          equityCurve.push({ time: trade.tradeTime, equity: totalEquity });

          if (totalEquity > peakCapital) peakCapital = totalEquity;
          const dd = (peakCapital - totalEquity) / peakCapital;
          if (dd > maxDrawdown) maxDrawdown = dd;

          const dailyReturn = (totalEquity - prevCapital) / prevCapital;
          dailyReturns.push(dailyReturn);
          prevCapital = totalEquity;
        }
      } catch (err) {
        console.error(`[Backtest] Error processing ${symbol}:`, err);
      }
    }

    // Close all remaining positions (use already-loaded candles from candleMap)
    for (const [sym, pos] of Array.from(positions.entries())) {
      try {
        const candles = candleMap.get(sym);
        if (candles && candles.length > 0) {
          const trade = makeSellTrade(pos, candles[candles.length - 1], "回测结束平仓", "close_all");
          allTrades.push(trade);
          capital += trade.totalAmount - trade.fee;
        }
      } catch { /* ignore */ }
    }
    positions.clear();

    // Calculate results
    const sellTrades = allTrades.filter(t => t.side === "sell");
    const winningTrades = sellTrades.filter(t => t.pnl > 0).length;
    const losingTrades = sellTrades.filter(t => t.pnl <= 0).length;
    const totalReturn = capital - config.initialCapital;
    const totalReturnPct = totalReturn / config.initialCapital;
    const winRate = sellTrades.length > 0 ? winningTrades / sellTrades.length : 0;

    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdReturn = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1))
      : 0;
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    const result: BacktestResult = {
      totalReturn, totalReturnPct, winRate, maxDrawdown, sharpeRatio,
      totalTrades: allTrades.length, winningTrades, losingTrades,
      benchmarkReturn, trades: allTrades, equityCurve,
    };

    // Save results to DB
    if (db) {
      await db.update(backtestSessions).set({
        status: "completed", progress: 100, completedAt: new Date(),
        totalReturn: String(totalReturn), totalReturnPct: String(totalReturnPct),
        winRate: String(winRate), maxDrawdown: String(maxDrawdown),
        sharpeRatio: String(sharpeRatio), totalTrades: allTrades.length,
        winningTrades, losingTrades, benchmarkReturn: String(benchmarkReturn),
        resultSummary: {
          equityCurve: equityCurve.slice(-500),
          spyCurve: spyCurve.slice(-500),
          qqqCurve: qqqCurve.slice(-500),
        },
        progressMessage: "回测完成",
      }).where(eq(backtestSessions.id, config.sessionId));

      if (allTrades.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < allTrades.length; i += batchSize) {
          const batch = allTrades.slice(i, i + batchSize);
          await db.insert(backtestTrades).values(batch.map(t => ({
            sessionId: config.sessionId,
            symbol: t.symbol, side: t.side as "buy" | "sell",
            quantity: String(t.quantity), price: String(t.price),
            totalAmount: String(t.totalAmount), fee: String(t.fee),
            commissionFee: String(t.commissionFee || 0), platformFee: String(t.platformFee || 0),
            reason: t.reason, signalType: t.signalType,
            tradeTime: t.tradeTime,
            pnl: String(t.pnl), pnlPct: String(t.pnlPct),
          })));
        }
      }
    }

    return result;
  } catch (error) {
    if (db) {
      await db.update(backtestSessions).set({
        status: "failed", progressMessage: `回测失败: ${error instanceof Error ? error.message : String(error)}`,
      }).where(eq(backtestSessions.id, config.sessionId));
    }
    throw error;
  }
}

// ============================================================
// Strategy dispatcher
// ============================================================
function runStrategyOnCandles(
  symbol: string, candles: Candle[], strategy: StrategyType,
  capital: number, maxPositionPct: number, positions: Map<string, Position>,
  params: StrategyParams
): TradeRecord[] {
  const maxVal = capital * (maxPositionPct / 100);
  switch (strategy) {
    case "standard": return runStandardStrategy(symbol, candles, maxVal, positions, params);
    case "aggressive": return runAggressiveStrategy(symbol, candles, maxVal, positions, params);
    case "ladder_cd_combo": return runLadderCDComboStrategy(symbol, candles, maxVal, positions, params);
    case "mean_reversion": return runMeanReversionStrategy(symbol, candles, maxVal, positions, params);
    case "macd_volume": return runMACDVolumeStrategy(symbol, candles, maxVal, positions, params);
    case "bollinger_squeeze": return runBollingerSqueezeStrategy(symbol, candles, maxVal, positions, params);
    case "vamr": return runVAMRStrategy(symbol, candles, maxVal, positions, params);
    case "ravts": return runRAVTSStrategy(symbol, candles, maxVal, positions, params);
    case "rsi_reversal": return runRSIReversalStrategy(symbol, candles, maxVal, positions, params);
    case "macd_divergence": return runMACDDivergenceStrategy(symbol, candles, maxVal, positions, params);
    default: return [];
  }
}

// ============================================================
// 1. Standard 4321 Strategy
// ============================================================
function runStandardStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 100) return trades;

  const ladder = calculateLadder(candles);
  const cdSignals = calculateCDSignals(candles);

  for (let i = 100; i < candles.length; i++) {
    const c = candles[i];
    const lad = ladder[i];
    const pos = positions.get(symbol);

    if (!pos) {
      const recentBuy = cdSignals.find(s => s.type === "buy" && s.time === c.time);
      if (recentBuy) {
        const buyAmount = maxPositionValue * (1 - (params.secondTranchePct || 0.5));
        const quantity = Math.floor(buyAmount / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close, recentBuy.label, "cd_buy_1", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: recentBuy.label, peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;

      // Second tranche
      const totalValue = pos.quantity * c.close;
      if (totalValue < maxPositionValue * 0.9 && c.close > lad.blueUp && (params.ladderConfirm !== false)) {
        const addAmount = maxPositionValue * (params.secondTranchePct || 0.5);
        const addQty = Math.floor(addAmount / c.close);
        if (addQty > 0) {
          trades.push(makeBuyTrade(symbol, addQty, c.close, "突破蓝梯加仓", "ladder_add", c.time));
          const newQty = pos.quantity + addQty;
          pos.avgPrice = (pos.quantity * pos.avgPrice + addQty * c.close) / newQty;
          pos.quantity = newQty;
        }
      }

      // Common exits
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) {
        trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType));
        positions.delete(symbol);
        continue;
      }

      // Strategy-specific exits
      const sellSignal = cdSignals.find(s => s.type === "sell" && s.time === c.time);
      const belowYellow = c.close < lad.yellowDn;
      if (sellSignal || belowYellow) {
        const reason = belowYellow ? "跌破黄梯下轨" : sellSignal?.label || "卖出信号";
        trades.push(makeSellTrade(pos, c, reason, "signal_sell"));
        positions.delete(symbol);
      }
    }
  }
  return trades;
}

// ============================================================
// 2. Aggressive Strategy
// ============================================================
function runAggressiveStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 100) return trades;

  const ladder = calculateLadder(candles);
  const cdSignals = calculateCDSignals(candles);

  for (let i = 100; i < candles.length; i++) {
    const c = candles[i];
    const lad = ladder[i];
    const pos = positions.get(symbol);

    if (!pos) {
      const recentBuy = cdSignals.find(s => s.type === "buy" && s.time === c.time);
      if (recentBuy && c.close > lad.blueMid) {
        const minStrength = params.minCDStrength || "weak";
        const strengthOrder = ["weak", "medium", "strong"];
        if (strengthOrder.indexOf(recentBuy.strength) >= strengthOrder.indexOf(minStrength)) {
          const quantity = Math.floor(maxPositionValue / c.close);
          if (quantity > 0) {
            trades.push(makeBuyTrade(symbol, quantity, c.close, `${recentBuy.label} + 站上蓝梯`, "aggressive_buy", c.time));
            positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: recentBuy.label, peakPrice: c.close, entryDay: i });
          }
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) {
        trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType));
        positions.delete(symbol);
        continue;
      }
      const sellSignal = cdSignals.find(s => s.type === "sell" && s.time === c.time);
      const belowBlue = c.close < lad.blueDn;
      if (sellSignal || belowBlue) {
        const reason = belowBlue ? "跌破蓝梯下轨" : sellSignal?.label || "卖出";
        trades.push(makeSellTrade(pos, c, reason, "signal_sell"));
        positions.delete(symbol);
      }
    }
  }
  return trades;
}

// ============================================================
// 3. Ladder + CD Combo Strategy (High Win Rate)
// ============================================================
function runLadderCDComboStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 120) return trades;

  const macd = calculateMACD(candles);
  const ladder = calculateLadder(candles);
  const cdSignals = calculateCDSignals(candles);

  for (let i = 120; i < candles.length; i++) {
    const c = candles[i];
    const lad = ladder[i];
    const prevLad = ladder[i - 1];
    const pos = positions.get(symbol);

    if (!pos) {
      const recentBuy = cdSignals.find(s => s.type === "buy" && s.time === c.time);
      if (!recentBuy) continue;

      const blueAboveYellow = lad.blueMid > lad.yellowMid;
      const priceAboveBlueMid = c.close > lad.blueMid;
      const macdAccel = params.requireMACDAccel !== false
        ? (macd.macd[i] > macd.macd[i - 1] && macd.macd[i] > macd.macd[i - 2])
        : true;
      const ladderGapOk = params.minLadderGap
        ? (lad.blueMid - lad.yellowMid) / lad.yellowMid > params.minLadderGap
        : true;

      if (blueAboveYellow && priceAboveBlueMid && macdAccel && ladderGapOk) {
        const isStrong = recentBuy.strength === "strong" && c.close > lad.blueUp;
        const sizePct = isStrong ? 1.0 : 0.7;
        const quantity = Math.floor((maxPositionValue * sizePct) / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close,
            `组合策略: ${recentBuy.label} + 蓝上黄 + MACD加速`, isStrong ? "combo_strong_buy" : "combo_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "combo", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) {
        trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType));
        positions.delete(symbol);
        continue;
      }
      const sellSignal = cdSignals.find(s => s.type === "sell" && s.time === c.time);
      const belowBlueLower = c.close < lad.blueDn;
      const trendReversal = prevLad.blueMid > prevLad.yellowMid && lad.blueMid < lad.yellowMid;
      if (sellSignal || belowBlueLower || trendReversal) {
        const reason = trendReversal ? "蓝梯下穿黄梯趋势反转" : belowBlueLower ? "跌破蓝梯下轨" : sellSignal?.label || "卖出";
        trades.push(makeSellTrade(pos, c, reason, trendReversal ? "trend_reversal" : "signal_sell"));
        positions.delete(symbol);
      }
    }
  }
  return trades;
}

// ============================================================
// 4. Mean Reversion Strategy (NEW - High Win Rate)
// ============================================================
function runMeanReversionStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 100) return trades;

  const rsi = calculateRSI(candles, 14);
  const bb = calculateBollingerBands(candles, params.meanPeriod || 20);
  const ladder = calculateLadder(candles);
  const oversold = params.rsiOversold || 30;
  const overbought = params.rsiOverbought || 70;

  for (let i = 50; i < candles.length; i++) {
    const c = candles[i];
    const lad = ladder[i];
    const pos = positions.get(symbol);

    if (!pos) {
      // Buy: RSI oversold + price near/below Bollinger lower + blue ladder not crashing
      const rsiLow = rsi[i] < oversold;
      const nearBBLower = c.close <= bb.lower[i] * 1.01;
      const notCrashing = lad.blueMid > lad.yellowDn; // blue not below yellow lower = not in free fall

      if (rsiLow && nearBBLower && notCrashing) {
        const quantity = Math.floor(maxPositionValue / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close,
            `均值回归: RSI=${rsi[i].toFixed(0)} + 触及布林下轨`, "mean_rev_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "mean_reversion", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) {
        trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType));
        positions.delete(symbol);
        continue;
      }
      // Strategy-specific exit: RSI overbought or price at BB upper
      const rsiHigh = rsi[i] > overbought;
      const nearBBUpper = c.close >= bb.upper[i] * 0.99;
      const reachMean = c.close >= bb.middle[i];
      if (rsiHigh || nearBBUpper || (reachMean && (c.close - pos.avgPrice) / pos.avgPrice > 0.03)) {
        const reason = rsiHigh ? `RSI超买=${rsi[i].toFixed(0)}` : nearBBUpper ? "触及布林上轨" : "回归均线止盈";
        trades.push(makeSellTrade(pos, c, reason, "mean_rev_sell"));
        positions.delete(symbol);
      }
    }
  }
  return trades;
}

// ============================================================
// 5. MACD Volume Strategy (NEW - High Win Rate)
// ============================================================
function runMACDVolumeStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 100) return trades;

  const macd = calculateMACD(candles, params.macdFast || 12, params.macdSlow || 26, params.macdSignal || 9);
  const ladder = calculateLadder(candles);
  const cdSignals = calculateCDSignals(candles);
  const volMultiplier = params.volumeMultiplier || 1.5;

  // Pre-compute 20-day average volume
  const avgVol: number[] = new Array(candles.length).fill(0);
  for (let i = 20; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - 20; j < i; j++) sum += candles[j].volume;
    avgVol[i] = sum / 20;
  }

  for (let i = 100; i < candles.length; i++) {
    const c = candles[i];
    const lad = ladder[i];
    const pos = positions.get(symbol);

    if (!pos) {
      // Buy: MACD golden cross + volume spike + price above blue mid
      const goldCross = i > 0 && macd.diff[i] > macd.dea[i] && macd.diff[i - 1] <= macd.dea[i - 1];
      const volumeSpike = avgVol[i] > 0 && c.volume > avgVol[i] * volMultiplier;
      const aboveBlueMid = c.close > lad.blueMid;

      if (goldCross && volumeSpike && aboveBlueMid) {
        const quantity = Math.floor(maxPositionValue / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close,
            `MACD金叉 + 量能放大${(c.volume / avgVol[i]).toFixed(1)}倍 + 蓝梯上方`, "macd_vol_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "macd_volume", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) {
        trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType));
        positions.delete(symbol);
        continue;
      }
      // Strategy-specific exit: MACD dead cross or CD sell signal
      const deadCross = i > 0 && macd.diff[i] < macd.dea[i] && macd.diff[i - 1] >= macd.dea[i - 1];
      const sellSignal = cdSignals.find(s => s.type === "sell" && s.time === c.time);
      const belowBlueLower = c.close < lad.blueDn;
      if (deadCross || sellSignal || belowBlueLower) {
        const reason = deadCross ? "MACD死叉" : belowBlueLower ? "跌破蓝梯下轨" : sellSignal?.label || "卖出";
        trades.push(makeSellTrade(pos, c, reason, "macd_vol_sell"));
        positions.delete(symbol);
      }
    }
  }
  return trades;
}

// ============================================================
// 6. Bollinger Squeeze Strategy (NEW - High Win Rate)
// ============================================================
function runBollingerSqueezeStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 100) return trades;

  const bb = calculateBollingerBands(candles, params.bbPeriod || 20, params.bbMultiplier || 2);
  const cdSignals = calculateCDSignals(candles);
  const ladder = calculateLadder(candles);
  const macd = calculateMACD(candles);
  const squeezeThreshold = params.squeezeThreshold || 0.04;

  // Track squeeze state
  let inSqueeze = false;

  for (let i = 50; i < candles.length; i++) {
    const c = candles[i];
    const lad = ladder[i];
    const pos = positions.get(symbol);

    // Detect squeeze: bandwidth below threshold
    if (bb.bandwidth[i] < squeezeThreshold) {
      inSqueeze = true;
    }

    if (!pos) {
      // Buy: was in squeeze + breakout above BB middle + MACD positive momentum
      if (inSqueeze && bb.bandwidth[i] > squeezeThreshold) {
        // Squeeze released
        const breakoutUp = c.close > bb.middle[i];
        const macdPositive = macd.macd[i] > 0 || (macd.diff[i] > macd.dea[i]);
        const aboveBlueMid = c.close > lad.blueMid;

        if (breakoutUp && macdPositive && aboveBlueMid) {
          const quantity = Math.floor(maxPositionValue / c.close);
          if (quantity > 0) {
            trades.push(makeBuyTrade(symbol, quantity, c.close,
              `布林收缩突破: 带宽${(bb.bandwidth[i] * 100).toFixed(1)}% + MACD正向`, "bb_squeeze_buy", c.time));
            positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "bb_squeeze", peakPrice: c.close, entryDay: i });
          }
          inSqueeze = false;
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) {
        trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType));
        positions.delete(symbol);
        inSqueeze = false;
        continue;
      }
      // Strategy-specific exit: price drops below BB middle or CD sell
      const belowMiddle = c.close < bb.middle[i] && (c.close - pos.avgPrice) / pos.avgPrice < -0.02;
      const sellSignal = cdSignals.find(s => s.type === "sell" && s.time === c.time);
      if (belowMiddle || sellSignal) {
        const reason = belowMiddle ? "跌破布林中轨" : sellSignal?.label || "卖出";
        trades.push(makeSellTrade(pos, c, reason, "bb_squeeze_sell"));
        positions.delete(symbol);
        inSqueeze = false;
      }
    }
  }
  return trades;
}

// ============================================================
// VAMR Strategy (Volatility-Adjusted Momentum Reversal)
// ============================================================
function runVAMRStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 50) return trades;
  const rsi = calculateRSI(candles, 4);
  const atr = calculateATR(candles, params.volatilityPeriod || 14);
  const ladder = calculateLadder(candles);
  const rsiThreshold = params.rsi4Threshold || 30;

  for (let i = 30; i < candles.length; i++) {
    const c = candles[i];
    const pos = positions.get(symbol);
    if (!pos) {
      const oversold = rsi[i] < rsiThreshold;
      const volatilityOk = atr[i] > 0 && c.close > ladder[i].yellowDn;
      if (oversold && volatilityOk) {
        const quantity = Math.floor(maxPositionValue / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close, `VAMR买入: RSI(4)=${rsi[i].toFixed(1)}<${rsiThreshold}`, "vamr_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "vamr", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) { trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType)); positions.delete(symbol); continue; }
      const dynamicStop = pos.avgPrice - atr[i] * 2;
      if (c.close < dynamicStop) { trades.push(makeSellTrade(pos, c, `VAMR动态止损(ATR*2)`, "vamr_stop")); positions.delete(symbol); }
    }
  }
  return trades;
}

// ============================================================
// RAVTS Strategy (Regime-Adjusted Volatility Trend System)
// ============================================================
function runRAVTSStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 60) return trades;
  const emaPeriod = params.emaPeriod || 20;
  const closes = candles.map(c => c.close);
  const emaArr: number[] = new Array(closes.length).fill(0);
  const k = 2 / (emaPeriod + 1);
  emaArr[0] = closes[0];
  for (let i = 1; i < closes.length; i++) emaArr[i] = closes[i] * k + emaArr[i - 1] * (1 - k);
  const atr = calculateATR(candles, 14);
  const volumeConfirmPct = params.volumeConfirmPct || 1.2;

  for (let i = 30; i < candles.length; i++) {
    const c = candles[i];
    const pos = positions.get(symbol);
    const avgVol = candles.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b.volume, 0) / Math.min(20, i);
    const emaSlope = emaArr[i] - emaArr[i - 3];
    if (!pos) {
      if (emaSlope > 0 && c.close > emaArr[i] && c.volume > avgVol * volumeConfirmPct) {
        const quantity = Math.floor(maxPositionValue / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close, `RAVTS买入: EMA上升+量能确认`, "ravts_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "ravts", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) { trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType)); positions.delete(symbol); continue; }
      if (emaSlope < 0 || c.close < emaArr[i] - atr[i]) {
        trades.push(makeSellTrade(pos, c, emaSlope < 0 ? "EMA趋势转空" : "跌破EMA-ATR", "ravts_exit"));
        positions.delete(symbol);
      }
    }
  }
  return trades;
}

// ============================================================
// RSI Reversal Strategy
// ============================================================
function runRSIReversalStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  if (candles.length < 30) return trades;
  const period = params.rsiPeriod || 14;
  const oversoldLevel = params.rsiReversal || 35;
  const overboughtLevel = 100 - oversoldLevel;
  const rsi = calculateRSI(candles, period);

  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i];
    const pos = positions.get(symbol);
    if (!pos) {
      if (rsi[i] > oversoldLevel && rsi[i - 1] <= oversoldLevel) {
        const quantity = Math.floor(maxPositionValue / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close, `RSI反转买入: RSI从${rsi[i-1].toFixed(1)}升至${rsi[i].toFixed(1)}`, "rsi_reversal_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "rsi_reversal", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) { trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType)); positions.delete(symbol); continue; }
      if (rsi[i] > overboughtLevel) { trades.push(makeSellTrade(pos, c, `RSI超买卖出: RSI=${rsi[i].toFixed(1)}`, "rsi_overbought_sell")); positions.delete(symbol); }
    }
  }
  return trades;
}

// ============================================================
// MACD Divergence Strategy
// ============================================================
function runMACDDivergenceStrategy(
  symbol: string, candles: Candle[], maxPositionValue: number,
  positions: Map<string, Position>, params: StrategyParams
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  const divergencePeriod = params.macdDivergencePeriod || 5;
  if (candles.length < 60) return trades;
  const macd = calculateMACD(candles, params.macdFast || 12, params.macdSlow || 26, params.macdSignal || 9);

  for (let i = 40; i < candles.length; i++) {
    const c = candles[i];
    const pos = positions.get(symbol);
    if (!pos) {
      const lookback = Math.min(divergencePeriod, i - 1);
      let priceLow = c.close, macdLow = macd.histogram[i], prevPriceLow = c.close, prevMacdLow = macd.histogram[i];
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].close < priceLow) { prevPriceLow = priceLow; prevMacdLow = macdLow; priceLow = candles[i - j].close; macdLow = macd.histogram[i - j]; }
      }
      const bullishDiv = priceLow < prevPriceLow && macdLow > prevMacdLow && macd.histogram[i] > macd.histogram[i - 1];
      if (bullishDiv && macd.diff[i] > macd.dea[i]) {
        const quantity = Math.floor(maxPositionValue / c.close);
        if (quantity > 0) {
          trades.push(makeBuyTrade(symbol, quantity, c.close, `MACD看涨背离买入`, "macd_divergence_buy", c.time));
          positions.set(symbol, { symbol, quantity, avgPrice: c.close, entryTime: c.time, entryReason: "macd_divergence", peakPrice: c.close, entryDay: i });
        }
      }
    } else {
      if (c.high > pos.peakPrice) pos.peakPrice = c.high;
      const exitCheck = checkCommonExits(pos, c, i, params);
      if (exitCheck) { trades.push(makeSellTrade(pos, c, exitCheck.reason, exitCheck.signalType)); positions.delete(symbol); continue; }
      if (macd.diff[i] < macd.dea[i] && macd.diff[i - 1] >= macd.dea[i - 1]) { trades.push(makeSellTrade(pos, c, `MACD死叉卖出`, "macd_death_cross")); positions.delete(symbol); }
    }
  }
  return trades;
}
