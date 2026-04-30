import * as cron from "node-cron";
import { STOCK_POOL } from "@shared/stockPool";
import { updateMarketCapBatch } from "./marketCapUpdater";
import { notifyOwner } from "./_core/notification";

let cronJob: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the market cap update cron job
 * Runs every day at 8:00 AM EST (13:00 UTC)
 * 
 * Cron expression: "0 13 * * *" means:
 * - 0: at minute 0
 * - 13: at hour 13 (UTC)
 * - *: every day of month
 * - *: every month
 * - *: every day of week
 */
export function startMarketCapCronScheduler(): void {
  if (cronJob) {
    console.log("[MarketCapCron] Scheduler already running, skipping initialization");
    return;
  }

  // Schedule for 8:00 AM EST = 13:00 UTC (during daylight saving time, it's 12:00 UTC)
  // Using 13:00 UTC which is 8:00 AM EDT (Eastern Daylight Time)
  const cronExpression = "0 13 * * *";

  cronJob = cron.schedule(cronExpression, async () => {
    console.log(`[MarketCapCron] Market cap update started at ${new Date().toISOString()}`);

    try {
      const allSymbols = STOCK_POOL.map((s) => s.symbol);

      // Batch processing to avoid API rate limiting
      const batchSize = 78; // Finnhub free tier: 60 calls/minute
      const batchCount = Math.ceil(allSymbols.length / batchSize);
      let totalSuccess = 0;
      let totalFailure = 0;
      const allFailedSymbols: string[] = [];

      for (let i = 0; i < batchCount; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, allSymbols.length);
        const batch = allSymbols.slice(start, end);

        console.log(`[MarketCapCron] Processing batch ${i + 1}/${batchCount} (${batch.length} symbols)`);

        const result = await updateMarketCapBatch(batch, "finnhub");
        totalSuccess += result.successCount;
        totalFailure += result.failureCount;
        allFailedSymbols.push(...result.failedSymbols);

        // Wait 60 seconds before next batch to avoid rate limiting
        if (i < batchCount - 1) {
          console.log(`[MarketCapCron] Waiting 60 seconds before next batch...`);
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      }

      const successRate = ((totalSuccess / allSymbols.length) * 100).toFixed(1);
      const message = `市值数据更新完成：${totalSuccess}/${allSymbols.length} 成功（${successRate}%）`;

      console.log(`[MarketCapCron] ${message}`);

      // Send notification to owner
      await notifyOwner({
        title: `📊 市值数据定期更新完成 - ${new Date().toLocaleDateString("zh-CN")}`,
        content: `${message}\n\n失败数量：${totalFailure}\n\n${
          totalFailure > 0 ? `失败的股票：${allFailedSymbols.slice(0, 10).join(", ")}${allFailedSymbols.length > 10 ? "..." : ""}` : ""
        }`,
      }).catch((e) => console.error("[MarketCapCron] Failed to send notification:", e));
    } catch (err: any) {
      const message = `市值数据更新失败：${err.message || "Unknown error"}`;
      console.error(`[MarketCapCron] ${message}`);

      await notifyOwner({
        title: `❌ 市值数据定期更新失败 - ${new Date().toLocaleDateString("zh-CN")}`,
        content: message,
      }).catch((e) => console.error("[MarketCapCron] Failed to send error notification:", e));
    }
  });

  console.log("[MarketCapCron] Market cap update scheduler started (8:00 AM EST daily)");
}

/**
 * Stop the market cap update cron job
 */
export function stopMarketCapCronScheduler(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("[MarketCapCron] Market cap update scheduler stopped");
  }
}

/**
 * Get the status of the cron job
 */
export function getMarketCapCronStatus(): { running: boolean; nextRun?: string } {
  if (!cronJob) {
    return { running: false };
  }

  return {
    running: true,
    nextRun: new Date().toISOString(), // Approximate next run time
  };
}
