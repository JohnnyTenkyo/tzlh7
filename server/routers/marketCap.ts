import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { updateMarketCapBatch, getMarketCap, getUpdateLog } from "../marketCapUpdater";
import { getDb } from "../db";
import { marketCapCache } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const marketCapRouter = router({
  /**
   * 批量更新市值数据（管理员专用）
   */
  updateBatch: protectedProcedure
    .input(z.object({
      symbols: z.array(z.string()),
      source: z.enum(["finnhub", "alphavantage"]).default("finnhub"),
    }))
    .mutation(async ({ input, ctx }: any) => {
      // 仅允许管理员执行
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin only");
      }
      
      return await updateMarketCapBatch(input.symbols, input.source);
    }),

  /**
   * 获取单个股票的市值
   */
  get: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }: any) => {
      const marketCap = await getMarketCap(input.symbol);
      return { symbol: input.symbol, marketCap };
    }),

  /**
   * 获取多个股票的市值
   */
  getBatch: publicProcedure
    .input(z.object({ symbols: z.array(z.string()) }))
    .query(async ({ input }: any) => {
      const db = await getDb();
      if (!db) return [];

      const results = await db
        .select()
        .from(marketCapCache)
        .where((col) => input.symbols.includes(col.symbol));

      return results.map((r) => ({
        symbol: r.symbol,
        marketCap: r.marketCap,
        source: r.source,
        lastUpdated: r.lastUpdated,
      }));
    }),

  /**
   * 获取更新日志
   */
  getUpdateLog: publicProcedure
    .input(z.object({ days: z.number().default(7) }))
    .query(async ({ input }: any) => {
      return await getUpdateLog(input.days);
    }),

  /**
   * 获取缓存统计
   */
  getStats: publicProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { total: 0, updated: 0 };

      const all = await db.select().from(marketCapCache);
      const updated = all.filter((r) => r.marketCap && r.marketCap > 0).length;

      return {
        total: all.length,
        updated,
        percentage: all.length > 0 ? ((updated / all.length) * 100).toFixed(1) : "0",
      };
    }),
});
