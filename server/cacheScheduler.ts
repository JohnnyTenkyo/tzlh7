import { getDb, getEnabledScheduledTasks, updateScheduledTaskExecution, recordWarmingProgress, updateWarmingStats } from "./db";
import { filterStocks, STOCK_POOL } from "@shared/stockPool";
import { getCandlesWithCache } from "./cacheManager";
import { handleDailyScanScheduled, handleDailyCacheScheduled } from "./routers";
import type { Timeframe } from "./marketData";

/**
 * 简单的 cron 表达式解析器
 * 支持格式: "0 2 * * *" (分 时 日 月 周)
 */
function shouldRunCron(cronExpression: string, now: Date = new Date()): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minStr, hourStr, dayStr, monthStr, dowStr] = parts;
  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const dow = now.getDay();

  const matchesPart = (part: string, value: number, max: number): boolean => {
    if (part === "*") return true;
    if (part === "?") return true;
    if (part.includes(",")) {
      return part.split(",").some(p => matchesPart(p, value, max));
    }
    if (part.includes("/")) {
      const [start, step] = part.split("/");
      const startVal = start === "*" ? 0 : parseInt(start);
      const stepVal = parseInt(step);
      return (value - startVal) % stepVal === 0 && value >= startVal;
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return value >= start && value <= end;
    }
    return parseInt(part) === value;
  };

  return (
    matchesPart(minStr, minute, 59) &&
    matchesPart(hourStr, hour, 23) &&
    matchesPart(dayStr, day, 31) &&
    matchesPart(monthStr, month, 12) &&
    matchesPart(dowStr, dow, 6)
  );
}

/**
 * 计算下一次执行时间
 */
function getNextExecutionTime(cronExpression: string): Date {
  const now = new Date();
  let checkTime = new Date(now.getTime() + 60000); // Start from next minute

  // Try for next 7 days
  for (let i = 0; i < 7 * 24 * 60; i++) {
    if (shouldRunCron(cronExpression, checkTime)) {
      return checkTime;
    }
    checkTime = new Date(checkTime.getTime() + 60000);
  }

  // Fallback to 1 day from now
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * 执行缓存预热任务
 */
async function executeWarmingTask(
  userId: number,
  taskId: number,
  sectors: string[] | null,
  marketCapTiers: string[] | null,
  customSymbols: string[] | null
) {
  try {
    let symbols: string[] = [];

    if (customSymbols && customSymbols.length > 0) {
      symbols = customSymbols;
    } else {
      const filterOptions: any = {};
      if (sectors && sectors.length > 0) filterOptions.sectors = sectors;
      if (marketCapTiers && marketCapTiers.length > 0) filterOptions.marketCapTiers = marketCapTiers;

      const filtered = filterStocks(STOCK_POOL, filterOptions);
      symbols = filtered.map(s => s.symbol);
    }

    if (symbols.length === 0) {
      console.log(`[CacheScheduler] Task ${taskId}: No symbols to warm`);
      return;
    }

    const taskIdStr = `scheduled-${taskId}-${Date.now()}`;
    console.log(`[CacheScheduler] Starting task ${taskId} with ${symbols.length} symbols`);

    // 预热 1d 时间框架的数据
    const timeframe: Timeframe = "1d";
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2); // 2 years of data
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = new Date().toISOString().split("T")[0];

    for (const symbol of symbols) {
      const startTime = Date.now();
      try {
        await getCandlesWithCache(symbol, timeframe, startDateStr, endDateStr);
        const duration = Date.now() - startTime;

        await recordWarmingProgress(userId, taskIdStr, symbol, "success", "scheduler", "", duration);
        await updateWarmingStats(userId, "scheduler", true, duration);

        console.log(`[CacheScheduler] Task ${taskId}: ${symbol} success (${duration}ms)`);
      } catch (err) {
        const duration = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);

        await recordWarmingProgress(userId, taskIdStr, symbol, "failed", "scheduler", errorMsg, duration);
        await updateWarmingStats(userId, "scheduler", false, duration);

        console.error(`[CacheScheduler] Task ${taskId}: ${symbol} failed - ${errorMsg}`);
      }
    }

    console.log(`[CacheScheduler] Task ${taskId} completed`);
  } catch (err) {
    console.error(`[CacheScheduler] Task ${taskId} error:`, err);
  }
}

/**
 * 检查是否应该在指定的 UTC 小时执行每日任务
 * 每天只执行一次，避免重复执行
 */
function shouldRunDailyTask(hour: number, lastRunDate: Date | null): boolean {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDate = now.getUTCDate();

  // 检查是否在目标小时内
  if (currentHour !== hour) return false;

  // 检查是否已在今天运行过
  if (lastRunDate) {
    const lastRunDateUTC = lastRunDate.getUTCDate();
    if (lastRunDateUTC === currentDate) return false;
  }

  return true;
}

// 记录上次执行时间
let lastDailyCacheRun: Date | null = null;
let lastDailyScanRun: Date | null = null;

/**
 * 主调度循环 - 每分钟检查一次待执行的任务
 */
export async function startCacheScheduler() {
  console.log("[CacheScheduler] Started");

  // 每分钟检查一次
  setInterval(async () => {
    try {
      const db = await getDb();
      if (!db) return;

      const now = new Date();

      // 检查每日 K 线缓存任务（UTC 09:00）
      if (shouldRunDailyTask(9, lastDailyCacheRun)) {
        console.log("[CacheScheduler] Running daily cache warming task at UTC 09:00");
        lastDailyCacheRun = now;
        try {
          const result = await handleDailyCacheScheduled();
          console.log("[CacheScheduler] Daily cache warming result:", result);
        } catch (err) {
          console.error("[CacheScheduler] Daily cache warming error:", err);
        }
      }

      // 检查每日全量扫描任务（UTC 14:00）
      if (shouldRunDailyTask(14, lastDailyScanRun)) {
        console.log("[CacheScheduler] Running daily scan task at UTC 14:00");
        lastDailyScanRun = now;
        try {
          const result = await handleDailyScanScheduled();
          console.log("[CacheScheduler] Daily scan result:", result);
        } catch (err) {
          console.error("[CacheScheduler] Daily scan error:", err);
        }
      }

      // 处理用户自定义的定时任务
      const tasks = await getEnabledScheduledTasks();

      for (const task of tasks) {
        // 检查是否应该执行
        if (!task.nextExecutedAt || new Date(task.nextExecutedAt) <= now) {
          // 执行任务
          await executeWarmingTask(
            task.userId,
            task.id,
            task.sectors as string[] | null,
            task.marketCapTiers as string[] | null,
            task.customSymbols as string[] | null
          );

          // 更新下次执行时间
          const nextExecution = getNextExecutionTime(task.cronExpression);
          await updateScheduledTaskExecution(task.id, nextExecution);
        }
      }
    } catch (err) {
      console.error("[CacheScheduler] Error in scheduler loop:", err);
    }
  }, 60000); // 每 60 秒检查一次
}

/**
 * 初始化所有任务的下次执行时间（应在服务器启动时调用）
 */
export async function initializeScheduledTasks() {
  try {
    const db = await getDb();
    if (!db) return;

    const tasks = await getEnabledScheduledTasks();
    const { updateScheduledTaskExecution } = await import("./db");

    for (const task of tasks) {
      if (!task.nextExecutedAt) {
        const nextExecution = getNextExecutionTime(task.cronExpression);
        await updateScheduledTaskExecution(task.id, nextExecution);
      }
    }

    console.log(`[CacheScheduler] Initialized ${tasks.length} scheduled tasks`);
  } catch (err) {
    console.error("[CacheScheduler] Error initializing tasks:", err);
  }
}
