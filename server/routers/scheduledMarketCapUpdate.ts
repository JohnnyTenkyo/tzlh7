import { STOCK_POOL } from "@shared/stockPool";
import { updateMarketCapBatch } from "../marketCapUpdater";
import { notifyOwner } from "../_core/notification";

/**
 * 定期市值更新任务处理器
 * 由 Manus 定期任务代理通过 POST /api/scheduled/market-cap-update 调用
 * 每天 06:00 UTC（北京时间 14:00）执行
 */
export async function handleMarketCapScheduledUpdate(): Promise<{
  success: boolean;
  message: string;
  stats: {
    totalSymbols: number;
    successCount: number;
    failureCount: number;
    failedSymbols: string[];
  };
}> {
  const allSymbols = STOCK_POOL.map((s) => s.symbol);

  try {
    console.log(`[MarketCapScheduler] Starting market cap update for ${allSymbols.length} symbols`);

    // 分批处理，避免 API 限流
    // Finnhub 免费版本有 60 calls/minute 的限制
    // 我们分成 10 批，每批 78 个股票，间隔 1 分钟
    const batchSize = 78;
    const batchCount = Math.ceil(allSymbols.length / batchSize);
    let totalSuccess = 0;
    let totalFailure = 0;
    const allFailedSymbols: string[] = [];

    for (let i = 0; i < batchCount; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, allSymbols.length);
      const batch = allSymbols.slice(start, end);

      console.log(`[MarketCapScheduler] Processing batch ${i + 1}/${batchCount} (${batch.length} symbols)`);

      const result = await updateMarketCapBatch(batch, "finnhub");
      totalSuccess += result.successCount;
      totalFailure += result.failureCount;
      allFailedSymbols.push(...result.failedSymbols);

      // 等待 1 分钟后再处理下一批（避免 API 限流）
      if (i < batchCount - 1) {
        console.log(`[MarketCapScheduler] Waiting 60 seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
    }

    const successRate = ((totalSuccess / allSymbols.length) * 100).toFixed(1);
    const message = `市值数据更新完成：${totalSuccess}/${allSymbols.length} 成功（${successRate}%）`;

    console.log(`[MarketCapScheduler] ${message}`);

    // 发送通知给项目所有者
    await notifyOwner({
      title: `📊 市值数据更新完成 - ${new Date().toLocaleDateString("zh-CN")}`,
      content: `${message}\n\n失败数量：${totalFailure}\n\n${
        totalFailure > 0 ? `失败的股票：${allFailedSymbols.slice(0, 10).join(", ")}${allFailedSymbols.length > 10 ? "..." : ""}` : ""
      }`,
    }).catch((e) => console.error("[MarketCapScheduler] Failed to send notification:", e));

    return {
      success: true,
      message,
      stats: {
        totalSymbols: allSymbols.length,
        successCount: totalSuccess,
        failureCount: totalFailure,
        failedSymbols: allFailedSymbols,
      },
    };
  } catch (err: any) {
    const message = `市值数据更新失败：${err.message || "Unknown error"}`;
    console.error(`[MarketCapScheduler] ${message}`);

    await notifyOwner({
      title: `❌ 市值数据更新失败 - ${new Date().toLocaleDateString("zh-CN")}`,
      content: message,
    }).catch((e) => console.error("[MarketCapScheduler] Failed to send error notification:", e));

    return {
      success: false,
      message,
      stats: {
        totalSymbols: STOCK_POOL.length,
        successCount: 0,
        failureCount: STOCK_POOL.length,
        failedSymbols: STOCK_POOL.map((s) => s.symbol),
      },
    };
  }
}
