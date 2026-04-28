/**
 * Technical Indicators Library
 * Provides: RSI, Bollinger Bands, ATR, MACD, Ladder, CD Signals, 4321 Score
 */

export interface Candle {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================
// EMA helper
// ============================================================
function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(data.length).fill(0);
  result[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ============================================================
// RSI
// ============================================================
export function calculateRSI(candles: Candle[], period = 14): number[] {
  const rsi: number[] = new Array(candles.length).fill(50);
  if (candles.length < period + 1) return rsi;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ============================================================
// Bollinger Bands
// ============================================================
export interface BollingerBands {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
}

export function calculateBollingerBands(candles: Candle[], period = 20, multiplier = 2): BollingerBands {
  const n = candles.length;
  const upper = new Array(n).fill(0);
  const middle = new Array(n).fill(0);
  const lower = new Array(n).fill(0);
  const bandwidth = new Array(n).fill(0);

  for (let i = period - 1; i < n; i++) {
    const slice = candles.slice(i - period + 1, i + 1).map(c => c.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    middle[i] = mean;
    upper[i] = mean + multiplier * std;
    lower[i] = mean - multiplier * std;
    bandwidth[i] = mean > 0 ? (upper[i] - lower[i]) / mean : 0;
  }
  return { upper, middle, lower, bandwidth };
}

// ============================================================
// ATR
// ============================================================
export function calculateATR(candles: Candle[], period = 14): number[] {
  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < 2) return atr;

  const trueRanges: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }

  let sum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  atr[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

// ============================================================
// MACD - uses diff/dea naming (Chinese convention)
// diff = MACD line (fast EMA - slow EMA)
// dea  = Signal line (EMA of diff)
// macd = Histogram (diff - dea) * 2
// ============================================================
export interface MACDResult {
  diff: number[];      // MACD line
  dea: number[];       // Signal line
  macd: number[];      // Histogram * 2
  signal: number[];    // alias for dea
  histogram: number[]; // alias for macd/2
}

export function calculateMACD(candles: Candle[], fast = 12, slow = 26, signal = 9): MACDResult {
  const closes = candles.map(c => c.close);
  const fastEMA = ema(closes, fast);
  const slowEMA = ema(closes, slow);
  const diff = fastEMA.map((v, i) => v - slowEMA[i]);
  const dea = ema(diff, signal);
  const macdHist2 = diff.map((v, i) => (v - dea[i]) * 2);
  const histogram = diff.map((v, i) => v - dea[i]);
  return { diff, dea, macd: macdHist2, signal: dea, histogram };
}

// ============================================================
// Ladder (Blue/Yellow lines with upper/mid/lower bands)
// ============================================================
export interface LadderLevel {
  blue: number;      // short-term EMA (alias for blueMid)
  yellow: number;    // long-term EMA (alias for yellowMid)
  gap: number;       // blue - yellow
  time?: number;     // candle timestamp (optional)
  blueMid: number;   // blue EMA midline
  blueUp: number;    // blue + 0.5 * ATR (upper band)
  blueDn: number;    // blue - 0.5 * ATR (lower band)
  yellowMid: number; // yellow EMA midline
  yellowUp: number;  // yellow + 0.5 * ATR (upper band)
  yellowDn: number;  // yellow - 0.5 * ATR (lower band)
}

export function calculateLadder(candles: Candle[], bluePeriod = 26, yellowPeriod = 89): LadderLevel[] {
  const closes = candles.map(c => c.close);
  const blueEMA = ema(closes, bluePeriod);
  const yellowEMA = ema(closes, yellowPeriod);
  const atr = calculateATR(candles, 14);

    return candles.map((c, i) => {
    const blue = blueEMA[i];
    const yellow = yellowEMA[i];
    const a = atr[i] || 0;
    return {
      blue,
      yellow,
      gap: blue - yellow,
      time: c.time,
      blueMid: blue,
      blueUp: blue + a * 0.5,
      blueDn: blue - a * 0.5,
      yellowMid: yellow,
      yellowUp: yellow + a * 0.5,
      yellowDn: yellow - a * 0.5,
    };
  });
}

// ============================================================
// CD Signals - with type "buy"/"sell" and time/label fields
// ============================================================
export interface CDSignal {
  index: number;
  time: number;       // candle timestamp (seconds)
  type: "buy" | "sell";
  strength: "weak" | "medium" | "strong";
  score: number;
  label: string;      // human-readable signal description
  description: string;
}

export function calculateCDSignals(candles: Candle[]): CDSignal[] {
  const signals: CDSignal[] = [];
  const rsi = calculateRSI(candles);
  const macdResult = calculateMACD(candles);
  const bb = calculateBollingerBands(candles);
  const ladder = calculateLadder(candles);

  for (let i = 3; i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    // === BUY signals ===
    if (rsi[i] < 30) { buyScore += 2; buyReasons.push("RSI超卖"); }
    else if (rsi[i] < 40) { buyScore += 1; buyReasons.push("RSI偏低"); }

    if (c.close <= bb.lower[i] * 1.02) { buyScore += 2; buyReasons.push("接近布林下轨"); }

    if (macdResult.diff[i] > macdResult.dea[i] && macdResult.diff[i - 1] <= macdResult.dea[i - 1]) {
      buyScore += 3; buyReasons.push("MACD金叉");
    } else if (macdResult.diff[i] > macdResult.dea[i]) {
      buyScore += 1; buyReasons.push("MACD多头");
    }

    if (ladder[i].gap > 0 && ladder[i - 1].gap <= 0) {
      buyScore += 2; buyReasons.push("梯队金叉");
    } else if (ladder[i].gap > 0) {
      buyScore += 1; buyReasons.push("梯队多头");
    }

    const avgVol = candles.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b.volume, 0) / Math.min(20, i);
    if (c.volume > avgVol * 1.5) { buyScore += 1; buyReasons.push("放量"); }

    if (c.close > c.open && c.close > prevC.close) { buyScore += 1; buyReasons.push("阳线"); }

    // === SELL signals ===
    if (rsi[i] > 70) { sellScore += 2; sellReasons.push("RSI超买"); }
    else if (rsi[i] > 65) { sellScore += 1; sellReasons.push("RSI偏高"); }

    if (c.close >= bb.upper[i] * 0.98) { sellScore += 2; sellReasons.push("接近布林上轨"); }

    if (macdResult.diff[i] < macdResult.dea[i] && macdResult.diff[i - 1] >= macdResult.dea[i - 1]) {
      sellScore += 3; sellReasons.push("MACD死叉");
    } else if (macdResult.diff[i] < macdResult.dea[i]) {
      sellScore += 1; sellReasons.push("MACD空头");
    }

    if (ladder[i].gap < 0 && ladder[i - 1].gap >= 0) {
      sellScore += 2; sellReasons.push("梯队死叉");
    } else if (ladder[i].gap < 0) {
      sellScore += 1; sellReasons.push("梯队空头");
    }

    if (buyScore >= 4) {
      const strength = buyScore >= 7 ? "strong" : buyScore >= 5 ? "medium" : "weak";
      const label = buyReasons.join(" + ");
      signals.push({ index: i, time: c.time, type: "buy", strength, score: buyScore, label, description: label });
    }

    if (sellScore >= 4) {
      const strength = sellScore >= 7 ? "strong" : sellScore >= 5 ? "medium" : "weak";
      const label = sellReasons.join(" + ");
      signals.push({ index: i, time: c.time, type: "sell", strength, score: sellScore, label, description: label });
    }
  }
  return signals;
}

// ============================================================
// 4321 Score (Multi-timeframe scoring)
// ============================================================
export type TimeframeCandles = Record<string, Candle[]>;

export interface Strategy4321Score {
  symbol: string;
  totalScore: number;
  buySignal: boolean;
  sellSignal: boolean;
  rsi: number;
  macdHistogram: number;
  ladderGap: number;
  bbPosition: number;
  volumeRatio: number;
  trend: "up" | "down" | "neutral";
  signals: string[];
}

export function calculate4321Score(symbol: string, candles: TimeframeCandles, lookbackDays = 5): Strategy4321Score {
  const dailyCandles = candles["1D"] || candles["daily"] || Object.values(candles)[0] || [];

  if (dailyCandles.length < 30) {
    return {
      symbol, totalScore: 0, buySignal: false, sellSignal: false,
      rsi: 50, macdHistogram: 0, ladderGap: 0, bbPosition: 0.5,
      volumeRatio: 1, trend: "neutral", signals: [],
    };
  }

  const recent = dailyCandles.slice(-Math.max(lookbackDays + 100, 150));
  const rsiArr = calculateRSI(recent);
  const macdResult = calculateMACD(recent);
  const bb = calculateBollingerBands(recent);
  const ladder = calculateLadder(recent);

  const last = recent.length - 1;
  const rsiVal = rsiArr[last];
  const macdHist = macdResult.histogram[last];
  const ladderGap = ladder[last].gap;
  const bbRange = bb.upper[last] - bb.lower[last];
  const bbPos = bbRange > 0 ? (recent[last].close - bb.lower[last]) / bbRange : 0.5;
  const avgVol = recent.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  const volRatio = avgVol > 0 ? recent[last].volume / avgVol : 1;

  let score = 0;
  const signals: string[] = [];

  if (rsiVal < 35) { score += 3; signals.push("RSI超卖"); }
  else if (rsiVal < 45) { score += 2; signals.push("RSI偏低"); }
  else if (rsiVal > 70) { score -= 2; signals.push("RSI超买"); }

  if (macdHist > 0 && macdResult.histogram[last - 1] <= 0) { score += 3; signals.push("MACD金叉"); }
  else if (macdHist > 0) { score += 1; signals.push("MACD多头"); }
  else if (macdHist < 0) { score -= 1; }

  if (ladderGap > 0) { score += 2; signals.push("梯队多头"); }
  else { score -= 1; }

  if (bbPos < 0.2) { score += 2; signals.push("接近布林下轨"); }
  else if (bbPos > 0.8) { score -= 1; }

  if (volRatio > 1.5) { score += 1; signals.push("放量"); }

  const trend = ladderGap > 0 && macdHist > 0 ? "up" : ladderGap < 0 && macdHist < 0 ? "down" : "neutral";

  return {
    symbol, totalScore: score, buySignal: score >= 5, sellSignal: score <= -2,
    rsi: rsiVal, macdHistogram: macdHist, ladderGap, bbPosition: bbPos,
    volumeRatio: volRatio, trend, signals,
  };
}

export interface AggressiveScore extends Strategy4321Score {
  aggressiveScore: number;
  momentum: number;
}

export function calculateAggressiveScore(symbol: string, candles: TimeframeCandles, lookbackDays = 5): AggressiveScore {
  const base = calculate4321Score(symbol, candles, lookbackDays);
  const dailyCandles = candles["1D"] || candles["daily"] || Object.values(candles)[0] || [];

  let momentum = 0;
  if (dailyCandles.length >= 10) {
    const recent = dailyCandles.slice(-10);
    const start = recent[0].close;
    const end = recent[recent.length - 1].close;
    momentum = start > 0 ? (end - start) / start : 0;
  }

  return {
    ...base,
    aggressiveScore: base.totalScore + (momentum > 0.05 ? 2 : momentum > 0 ? 1 : 0),
    momentum,
  };
}
