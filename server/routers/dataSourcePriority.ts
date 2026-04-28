import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { dataSourcePriority } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DEFAULT_SOURCE_ORDER = ["eodhd", "tiingo", "finnhub", "alphavantage", "polygon", "twelvedata", "stooq", "yahoo", "marketstack"];

export const dataSourcePriorityRouter = {
  // Get user's data source priority
  getPriority: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");
    const userId = ctx.user.id;

    const existing = await db
      .select()
      .from(dataSourcePriority)
      .where(eq(dataSourcePriority.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      return {
        sourceOrder: existing[0].sourceOrder,
      };
    }

    // Return default if not set
    return {
      sourceOrder: DEFAULT_SOURCE_ORDER,
    };
  }),

  // Update user's data source priority
  updatePriority: protectedProcedure
    .input(
      z.object({
        sourceOrder: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const userId = ctx.user.id;

      // Validate that all sources are valid
      const validSources = new Set(DEFAULT_SOURCE_ORDER);
      for (const source of input.sourceOrder) {
        if (!validSources.has(source)) {
          throw new Error(`Invalid data source: ${source}`);
        }
      }

      // Check if record exists
      const existing = await db
        .select()
        .from(dataSourcePriority)
        .where(eq(dataSourcePriority.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db
          .update(dataSourcePriority)
          .set({
            sourceOrder: input.sourceOrder,
            updatedAt: new Date(),
          })
          .where(eq(dataSourcePriority.userId, userId));
      } else {
        // Insert new
        await db.insert(dataSourcePriority).values({
          userId,
          sourceOrder: input.sourceOrder,
        });
      }

      return {
        success: true,
        sourceOrder: input.sourceOrder,
      };
    }),

  // Reset to default priority
  resetToDefault: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");
    const userId = ctx.user.id;

    const existing = await db
      .select()
      .from(dataSourcePriority)
      .where(eq(dataSourcePriority.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(dataSourcePriority)
        .set({
          sourceOrder: DEFAULT_SOURCE_ORDER,
          updatedAt: new Date(),
        })
        .where(eq(dataSourcePriority.userId, userId));
    } else {
      await db.insert(dataSourcePriority).values({
        userId,
        sourceOrder: DEFAULT_SOURCE_ORDER,
      });
    }

    return {
      success: true,
      sourceOrder: DEFAULT_SOURCE_ORDER,
    };
  }),
};
