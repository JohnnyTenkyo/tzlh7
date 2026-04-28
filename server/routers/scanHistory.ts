import { z } from "zod";
import { publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { scanResults } from "../../drizzle/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";

export const scanHistoryRouter = {
  // Get scan results for a specific date
  getByDate: publicProcedure
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
        strategy: z.string().optional(),
        signalType: z.enum(["buy", "sell", "hold"]).optional(),
        symbol: z.string().optional(), // Filter by stock symbol
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");

      const conditions = [eq(scanResults.scanDate, input.date)];

      if (input.strategy) {
        conditions.push(eq(scanResults.strategy, input.strategy));
      }

      if (input.signalType) {
        conditions.push(eq(scanResults.signalType, input.signalType));
      }

      if (input.symbol) {
        conditions.push(eq(scanResults.symbol, input.symbol.toUpperCase()));
      }

      const results = await db
        .select()
        .from(scanResults)
        .where(and(...conditions))
        .orderBy(desc(scanResults.score));

      return {
        date: input.date,
        total: results.length,
        results: results.map(r => ({
          symbol: r.symbol,
          strategy: r.strategy,
          signalType: r.signalType,
          score: r.score,
          rsi: r.rsi,
          macdHistogram: r.macdHistogram,
          ladderGap: r.ladderGap,
          bbPosition: r.bbPosition,
          volumeRatio: r.volumeRatio,
          trend: r.trend,
        })),
      };
    }),

  // Get available scan dates
  getAvailableDates: publicProcedure
    .input(
      z.object({
        limit: z.number().default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");

      // Get distinct dates from scan results
      const results = await db
        .selectDistinct({ scanDate: scanResults.scanDate })
        .from(scanResults)
        .orderBy(desc(scanResults.scanDate))
        .limit(input.limit);

      return {
        dates: results.map(r => r.scanDate),
      };
    }),

  // Get scan statistics for a date
  getStatsByDate: publicProcedure
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");

      const results = await db
        .select()
        .from(scanResults)
        .where(eq(scanResults.scanDate, input.date));

      const stats = {
        total: results.length,
        buySignals: results.filter(r => r.signalType === "buy").length,
        sellSignals: results.filter(r => r.signalType === "sell").length,
        holdSignals: results.filter(r => r.signalType === "hold").length,
        byStrategy: {} as Record<string, number>,
        avgScore: 0,
      };

      // Count by strategy
      for (const r of results) {
        stats.byStrategy[r.strategy] = (stats.byStrategy[r.strategy] || 0) + 1;
      }

      // Calculate average score
      if (results.length > 0) {
        stats.avgScore = Math.round(
          results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length
        );
      }

      return stats;
    }),

  // Get date range statistics
  getDateRangeStats: publicProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");

      const results = await db
        .select()
        .from(scanResults)
        .where(
          and(
            gte(scanResults.scanDate, input.startDate),
            lte(scanResults.scanDate, input.endDate)
          )
        );

      const stats = {
        startDate: input.startDate,
        endDate: input.endDate,
        total: results.length,
        buySignals: results.filter(r => r.signalType === "buy").length,
        sellSignals: results.filter(r => r.signalType === "sell").length,
        uniqueSymbols: Array.from(new Set(results.map(r => r.symbol))).length,
        byDate: {} as Record<string, number>,
      };

      // Count by date
      for (const r of results) {
        stats.byDate[r.scanDate] = (stats.byDate[r.scanDate] || 0) + 1;
      }

      return stats;
    }),

  // ============================================================
  // Cross-date tracking: get 30-day signal trend for a symbol
  // ============================================================
  getSymbolTrend: publicProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");

      // Calculate date range (last N days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];

      const sym = input.symbol.toUpperCase();

      const rows = await db
        .select()
        .from(scanResults)
        .where(
          and(
            eq(scanResults.symbol, sym),
            gte(scanResults.scanDate, startDateStr),
            lte(scanResults.scanDate, endDateStr)
          )
        )
        .orderBy(scanResults.scanDate);

      if (rows.length === 0) {
        return {
          symbol: sym,
          days: input.days,
          startDate: startDateStr,
          endDate: endDateStr,
          hasData: false,
          dailyPoints: [],
          strategies: [],
          summary: {
            totalBuy: 0,
            totalSell: 0,
            totalHold: 0,
            avgScore: 0,
            maxScore: 0,
            activeDays: 0,
          },
        };
      }

      // Group by date
      const byDate: Record<string, typeof rows> = {};
      for (const r of rows) {
        if (!byDate[r.scanDate]) byDate[r.scanDate] = [];
        byDate[r.scanDate].push(r);
      }

      // Build daily data points
      const dailyPoints = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayRows]) => {
          const buyRows = dayRows.filter(r => r.signalType === "buy");
          const sellRows = dayRows.filter(r => r.signalType === "sell");
          const avgScore = Math.round(
            dayRows.reduce((s, r) => s + (r.score || 0), 0) / dayRows.length
          );
          const maxScore = Math.max(...dayRows.map(r => r.score || 0));
          // Dominant signal: most buy = buy, most sell = sell, else hold
          const dominantSignal =
            buyRows.length > sellRows.length
              ? "buy"
              : sellRows.length > buyRows.length
              ? "sell"
              : "hold";

          return {
            date,
            avgScore,
            maxScore,
            buyCount: buyRows.length,
            sellCount: sellRows.length,
            holdCount: dayRows.filter(r => r.signalType === "hold").length,
            totalStrategies: dayRows.length,
            dominantSignal,
            // Per-strategy scores for this date
            byStrategy: dayRows.reduce(
              (acc, r) => {
                acc[r.strategy] = { signal: r.signalType, score: r.score || 0 };
                return acc;
              },
              {} as Record<string, { signal: string; score: number }>
            ),
          };
        });

      // Unique strategies seen
      const strategies = Array.from(new Set(rows.map(r => r.strategy)));

      // Summary stats
      const summary = {
        totalBuy: rows.filter(r => r.signalType === "buy").length,
        totalSell: rows.filter(r => r.signalType === "sell").length,
        totalHold: rows.filter(r => r.signalType === "hold").length,
        avgScore: Math.round(
          rows.reduce((s, r) => s + (r.score || 0), 0) / rows.length
        ),
        maxScore: Math.max(...rows.map(r => r.score || 0)),
        activeDays: dailyPoints.length,
      };

      return {
        symbol: sym,
        days: input.days,
        startDate: startDateStr,
        endDate: endDateStr,
        hasData: true,
        dailyPoints,
        strategies,
        summary,
      };
    }),
};
