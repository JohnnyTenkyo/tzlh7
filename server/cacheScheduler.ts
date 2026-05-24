import { getDb, getEnabledScheduledTasks, updateScheduledTaskExecution, recordWarmingProgress, updateWarmingStats, getNextExecutionTime } from "./db";
import { filterStocks, STOCK_POOL } from "@shared/stockPool";
import { getCandlesWithCache } from "./cacheManager";
import { handleDailyScanScheduled, handleDailyCacheScheduled } from "./routers";
import type { Timeframe } from "./marketData";
import { sql } from "drizzle-orm";

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
 * 支持测试时间注入
 */
function shouldRunDailyTask(hour: number, lastRunDate: Date | null, testNow?: Date): boolean {
  const now = testNow || new Date();
  const currentHour = now.getUTCHours();
  const currentDate = now.getUTCDate();
  const currentMonth = now.getUTCMonth();
  const currentYear = now.getUTCFullYear();

  // 检查是否在目标小时内
  if (currentHour !== hour) return false;

  // 检查是否已在今天运行过（需要比较年月日）
  if (lastRunDate) {
    const lastRunDateUTC = lastRunDate.getUTCDate();
    const lastRunMonthUTC = lastRunDate.getUTCMonth();
    const lastRunYearUTC = lastRunDate.getUTCFullYear();
    
    // 如果上次运行是同一天，则不再运行
    if (lastRunYearUTC === currentYear && lastRunMonthUTC === currentMonth && lastRunDateUTC === currentDate) {
      return false;
    }
  }

  return true;
}

// 记录上次执行时间
let lastDailyCacheRun: Date | null = null;
let lastDailyScanRun: Date | null = null;

// 定时任务状态存储键
const LAST_DAILY_SCAN_RUN_KEY = "scheduler:lastDailyScanRun";
const LAST_DAILY_CACHE_RUN_KEY = "scheduler:lastDailyCacheRun";

/**
 * 主调度循环 - 每分钟检查一次待执行的任务
 */
export async function startCacheScheduler() {
  console.log("[CacheScheduler] Started");
  
  // 第一次立即检查一次
  console.log("[CacheScheduler] Initial check - lastDailyScanRun:", lastDailyScanRun, "lastDailyCacheRun:", lastDailyCacheRun);

  // 每分钟检查一次
  const intervalId = setInterval(async () => {
    try {
      const db = await getDb();
      if (!db) {
        console.warn("[CacheScheduler] Database connection failed");
        return;
      }
      
      // 每次都记录（不管是否执行任务）
      console.log("[CacheScheduler] Loop iteration at", new Date().toISOString());

      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();

      // 检查每日 K 线缓存任务（UTC 12:00 = 美东时间 08:00 AM）
      // 每小时记录一次状态
      if (utcMinute === 0) {
        console.log(`[CacheScheduler] Hourly check at UTC ${utcHour}:${String(utcMinute).padStart(2, '0')} - lastDailyScanRun: ${lastDailyScanRun?.toISOString() || 'null'}, lastDailyCacheRun: ${lastDailyCacheRun?.toISOString() || 'null'}`);
      }
      
      if (shouldRunDailyTask(12, lastDailyCacheRun)) {
        console.log("[CacheScheduler] Running daily cache warming task at UTC 12:00 (08:00 AM EDT)");
        lastDailyCacheRun = now;
        await saveScheduledTasksState(); // 保存状态
        try {
          const result = await handleDailyCacheScheduled();
          console.log("[CacheScheduler] Daily cache warming result:", result);
        } catch (err) {
          console.error("[CacheScheduler] Daily cache warming error:", err);
        }
      }

      // 检查每日全量扫描任务（UTC 10:00 = 美东时间 06:00 AM）
      if (shouldRunDailyTask(10, lastDailyScanRun)) {
        console.log("[CacheScheduler] Running daily scan task at UTC 10:00 (06:00 AM EDT)");
        lastDailyScanRun = now;
        await saveScheduledTasksState(); // 保存状态
        try {
          const result = await handleDailyScanScheduled();
          console.log("[CacheScheduler] Daily scan result:", result);
        } catch (err) {
          console.error("[CacheScheduler] Daily scan error:", err);
        }
      } else if (now.getUTCHours() === 10) {
        console.log("[CacheScheduler] UTC 10:00 reached but task already ran today. lastDailyScanRun:", lastDailyScanRun);
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
  
  console.log("[CacheScheduler] Interval started with ID:", intervalId);
}

/**
 * 从数据库恢复上次执行时间
 */
async function restoreScheduledTasksState() {
  try {
    const db = await getDb();
    if (!db) return;
    
    // 尝试从数据库恢复状态
    const rows = await db.execute(sql`
      SELECT \`key\`, \`value\` FROM system_config 
      WHERE \`key\` IN (${LAST_DAILY_SCAN_RUN_KEY}, ${LAST_DAILY_CACHE_RUN_KEY})
    `) as any;
    
    for (const row of rows) {
      if (row.key === LAST_DAILY_SCAN_RUN_KEY && row.value) {
        lastDailyScanRun = new Date(row.value);
        console.log("[CacheScheduler] Restored lastDailyScanRun:", lastDailyScanRun.toISOString());
      } else if (row.key === LAST_DAILY_CACHE_RUN_KEY && row.value) {
        lastDailyCacheRun = new Date(row.value);
        console.log("[CacheScheduler] Restored lastDailyCacheRun:", lastDailyCacheRun.toISOString());
      }
    }
  } catch (err) {
    console.warn("[CacheScheduler] Failed to restore state:", err);
  }
}

/**
 * 保存定时任务状态到数据库
 */
async function saveScheduledTasksState() {
  try {
    const db = await getDb();
    if (!db) return;
    
    const updates = [];
    if (lastDailyScanRun) {
      updates.push({
        key: LAST_DAILY_SCAN_RUN_KEY,
        value: lastDailyScanRun.toISOString(),
      });
    }
    if (lastDailyCacheRun) {
      updates.push({
        key: LAST_DAILY_CACHE_RUN_KEY,
        value: lastDailyCacheRun.toISOString(),
      });
    }
    
    for (const update of updates) {
      await db.execute(sql`
        INSERT INTO system_config (\`key\`, \`value\`) 
        VALUES (${update.key}, ${update.value})
        ON DUPLICATE KEY UPDATE \`value\` = ${update.value}
      `).catch(err => console.warn("[CacheScheduler] Failed to save state:", err));
    }
  } catch (err) {
    console.warn("[CacheScheduler] Failed to save state:", err);
  }
}

/**
 * 初始化所有任务的下次执行时间（应在服务器启动时调用）
 */
export async function initializeScheduledTasks() {
  try {
    // 先恢复之前的状态
    await restoreScheduledTasksState();
    
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
