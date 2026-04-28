/**
 * AI Strategy Module
 * Primary: Gemini AI (via openfly.cc/antigravity proxy)
 * Fallback: OpenAI (via openfly.cc/v1 proxy)
 * Auto-failover: if Gemini fails, automatically switches to OpenAI
 */
import axios from "axios";
import { ENV } from "./_core/env";
import type { Candle } from "./marketData";

export interface GeminiStrategyAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  riskAssessment: string;
  marketCondition: string;
  overallScore: number; // 0-100
  aiProvider?: "gemini" | "openai"; // which AI was used
}

export interface BacktestMetrics {
  strategy: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  totalReturnPct: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  benchmarkReturn: number;
}

// ============================================================
// Core API callers
// ============================================================

async function callGeminiAPI(prompt: string): Promise<string> {
  const apiKey = ENV.geminiApiKey;
  const baseUrl = (ENV.geminiBaseUrl || "https://openfly.cc").replace(/\/$/, "");
  const model = ENV.geminiModel || "gemini-2.0-flash";

  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const res = await axios.post(
    `${baseUrl}/v1/chat/completions`,
    {
      model,
      messages: [
        {
          role: "system",
          content: "你是一位专业的量化交易策略分析师，擅长分析回测结果并提供专业的投资建议。请用中文回答，保持专业、客观、简洁。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 30000,
    }
  );

  const content = res.data?.choices?.[0]?.message?.content || "";
  if (!content) throw new Error("Empty response from Gemini API");
  return content;
}

async function callOpenAIAPI(prompt: string): Promise<string> {
  const apiKey = ENV.openaiApiKey;
  const baseUrl = (ENV.openaiBaseUrl || "https://openfly.cc/v1").replace(/\/$/, "");
  const model = ENV.openaiModel || "gpt-5.1-codex";

  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model,
      messages: [
        {
          role: "system",
          content: "你是一位专业的量化交易策略分析师，擅长分析回测结果并提供专业的投资建议。请用中文回答，保持专业、客观、简洁。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      store: false,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 30000,
    }
  );

  const content = res.data?.choices?.[0]?.message?.content || "";
  if (!content) throw new Error("Empty response from OpenAI API");
  return content;
}

/**
 * Calls AI with automatic failover: Gemini first, then OpenAI.
 * Returns { text, provider } so callers know which AI was used.
 */
async function callAIWithFallback(prompt: string): Promise<{ text: string; provider: "gemini" | "openai" }> {
  // Try Gemini first
  if (ENV.geminiApiKey) {
    try {
      const text = await callGeminiAPI(prompt);
      return { text, provider: "gemini" };
    } catch (err) {
      console.warn("[AI] Gemini failed, falling back to OpenAI:", err instanceof Error ? err.message : String(err));
    }
  }

  // Fallback to OpenAI
  if (ENV.openaiApiKey) {
    try {
      const text = await callOpenAIAPI(prompt);
      return { text, provider: "openai" };
    } catch (err) {
      console.error("[AI] OpenAI fallback also failed:", err instanceof Error ? err.message : String(err));
      throw new Error(`所有AI服务均不可用: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error("未配置任何AI API密钥（GEMINI_API_KEY 或 OPENAI_API_KEY）");
}

// ============================================================
// Public API
// ============================================================

export async function analyzeBacktestResult(metrics: BacktestMetrics): Promise<GeminiStrategyAnalysis> {
  const strategyNames: Record<string, string> = {
    standard: "标准策略(4321分批建仓)",
    aggressive: "激进策略",
    ladder_cd_combo: "黄蓝梯子+CD组合策略",
    mean_reversion: "均值回归策略",
    macd_volume: "MACD量价策略",
    bollinger_squeeze: "布林带收缩突破策略",
    gemini_ai: "AI智能策略",
  };

  const strategyName = strategyNames[metrics.strategy] || metrics.strategy;
  const prompt = `
请分析以下量化回测结果，提供专业的策略评估：

**策略名称**: ${strategyName}
**回测标的**: ${metrics.symbols.slice(0, 10).join(", ")}${metrics.symbols.length > 10 ? `...等${metrics.symbols.length}只` : ""}
**回测区间**: ${metrics.startDate} 至 ${metrics.endDate}
**总收益率**: ${(metrics.totalReturnPct * 100).toFixed(2)}%
**胜率**: ${(metrics.winRate * 100).toFixed(2)}%
**最大回撤**: ${(metrics.maxDrawdown * 100).toFixed(2)}%
**夏普比率**: ${metrics.sharpeRatio?.toFixed(3) || "N/A"}
**总交易次数**: ${metrics.totalTrades}
**基准收益(SPY)**: ${(metrics.benchmarkReturn * 100).toFixed(2)}%

请以JSON格式返回分析结果，包含以下字段：
{
  "summary": "总体评价（2-3句话）",
  "strengths": ["优势1", "优势2", "优势3"],
  "weaknesses": ["劣势1", "劣势2"],
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "riskAssessment": "风险评估（1-2句话）",
  "marketCondition": "适合的市场条件（1句话）",
  "overallScore": 75
}
`;

  try {
    const { text, provider } = await callAIWithFallback(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || "分析完成",
        strengths: parsed.strengths || [],
        weaknesses: parsed.weaknesses || [],
        suggestions: parsed.suggestions || [],
        riskAssessment: parsed.riskAssessment || "",
        marketCondition: parsed.marketCondition || "",
        overallScore: Math.min(100, Math.max(0, parsed.overallScore || 50)),
        aiProvider: provider,
      };
    }
    return {
      summary: text.slice(0, 500),
      strengths: [], weaknesses: [], suggestions: [],
      riskAssessment: "", marketCondition: "", overallScore: 50,
      aiProvider: "gemini",
    };
  } catch (err) {
    console.error("[AIStrategy] Analysis failed:", err);
    throw new Error(`AI分析失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function generateGeminiStrategy(
  symbol: string,
  candles: Candle[],
  indicators: {
    macd?: { diff: number[]; dea: number[]; macd: number[] };
    ladder?: Array<{ blueUp: number; blueDn: number; yellowUp: number; yellowDn: number }>;
    rsi?: number[];
  }
): Promise<{ signal: "buy" | "sell" | "hold"; confidence: number; reasoning: string; aiProvider?: string }> {
  if (candles.length < 30) {
    return { signal: "hold", confidence: 0.5, reasoning: "数据不足，无法分析" };
  }

  const recent = candles.slice(-20);
  const latestCandle = recent[recent.length - 1];
  const prevCandle = recent[recent.length - 2];
  const priceChange = ((latestCandle.close - prevCandle.close) / prevCandle.close * 100).toFixed(2);

  const macdLatest = indicators.macd ? {
    diff: indicators.macd.diff[indicators.macd.diff.length - 1]?.toFixed(4),
    dea: indicators.macd.dea[indicators.macd.dea.length - 1]?.toFixed(4),
    macd: indicators.macd.macd[indicators.macd.macd.length - 1]?.toFixed(4),
  } : null;

  const ladderLatest = indicators.ladder?.[indicators.ladder.length - 1];
  const rsiLatest = indicators.rsi?.[indicators.rsi.length - 1]?.toFixed(2);

  const prompt = `
请分析以下股票技术指标数据，给出交易信号：

**股票**: ${symbol}
**最新收盘价**: ${latestCandle.close.toFixed(2)}
**今日涨跌**: ${priceChange}%
**成交量**: ${latestCandle.volume.toLocaleString()}

**技术指标**:
${macdLatest ? `- MACD: DIFF=${macdLatest.diff}, DEA=${macdLatest.dea}, BAR=${macdLatest.macd}` : ""}
${ladderLatest ? `- 蓝梯: 上轨=${ladderLatest.blueUp?.toFixed(2)}, 下轨=${ladderLatest.blueDn?.toFixed(2)}` : ""}
${ladderLatest ? `- 黄梯: 上轨=${ladderLatest.yellowUp?.toFixed(2)}, 下轨=${ladderLatest.yellowDn?.toFixed(2)}` : ""}
${rsiLatest ? `- RSI(14): ${rsiLatest}` : ""}

**近5日价格**: ${recent.slice(-5).map(c => c.close.toFixed(2)).join(", ")}

请以JSON格式返回：
{
  "signal": "buy/sell/hold",
  "confidence": 0.75,
  "reasoning": "分析理由（2-3句话）"
}
`;

  try {
    const { text, provider } = await callAIWithFallback(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        signal: ["buy", "sell", "hold"].includes(parsed.signal) ? parsed.signal : "hold",
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning || "无法获取分析结果",
        aiProvider: provider,
      };
    }
    return { signal: "hold", confidence: 0.5, reasoning: text.slice(0, 200) };
  } catch (err) {
    console.error("[AIStrategy] Signal generation failed:", err);
    return { signal: "hold", confidence: 0.3, reasoning: `AI信号生成失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function testGeminiConnection(): Promise<{ gemini: boolean; openai: boolean }> {
  const results = { gemini: false, openai: false };

  if (ENV.geminiApiKey) {
    try {
      const result = await callGeminiAPI("请回复'OK'，不需要其他内容。");
      results.gemini = result.length > 0;
    } catch {
      results.gemini = false;
    }
  }

  if (ENV.openaiApiKey) {
    try {
      const result = await callOpenAIAPI("请回复'OK'，不需要其他内容。");
      results.openai = result.length > 0;
    } catch {
      results.openai = false;
    }
  }

  return results;
}

export async function testOpenAIConnection(): Promise<boolean> {
  if (!ENV.openaiApiKey) return false;
  try {
    const result = await callOpenAIAPI("请回复'OK'，不需要其他内容。");
    return result.length > 0;
  } catch {
    return false;
  }
}
