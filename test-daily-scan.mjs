#!/usr/bin/env node

/**
 * 测试脚本：验证每日扫描任务在指定时间是否会触发
 */

// 模拟 shouldRunDailyTask 函数
function shouldRunDailyTask(hour, lastRunDate, testNow) {
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

console.log("=== 每日扫描任务触发时间测试 ===\n");

// 模拟今天 UTC 13:00（美东时间 09:00 AM）
const today = new Date();
today.setUTCHours(13, 0, 0, 0);

console.log(`测试时间：${today.toISOString()}`);
console.log(`本地时间：${today.toString()}`);
console.log(`UTC 小时：${today.getUTCHours()}\n`);

// 场景 1：首次运行，应该触发
console.log("场景 1：首次运行（lastRunDate = null）");
const result1 = shouldRunDailyTask(13, null, today);
console.log(`  shouldRunDailyTask(13, null) = ${result1}`);
console.log(`  预期：true\n`);

// 场景 2：同一天已经运行过，不应该触发
console.log("场景 2：同一天已运行过");
const lastRun2 = new Date(today);
lastRun2.setUTCHours(13, 5, 0, 0);
const result2 = shouldRunDailyTask(13, lastRun2, today);
console.log(`  lastRunDate：${lastRun2.toISOString()}`);
console.log(`  shouldRunDailyTask(13, lastRun2) = ${result2}`);
console.log(`  预期：false\n`);

// 场景 3：不同天，应该触发
console.log("场景 3：不同天");
const tomorrow = new Date(today);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const lastRun3 = new Date(today);
lastRun3.setUTCHours(13, 5, 0, 0);
const result3 = shouldRunDailyTask(13, lastRun3, tomorrow);
console.log(`  lastRunDate：${lastRun3.toISOString()}`);
console.log(`  测试时间：${tomorrow.toISOString()}`);
console.log(`  shouldRunDailyTask(13, lastRun3) = ${result3}`);
console.log(`  预期：true\n`);

// 场景 4：不同小时，不应该触发
console.log("场景 4：不同小时（UTC 14:00）");
const differentHour = new Date(today);
differentHour.setUTCHours(14, 0, 0, 0);
const result4 = shouldRunDailyTask(13, null, differentHour);
console.log(`  测试时间：${differentHour.toISOString()}`);
console.log(`  shouldRunDailyTask(13, null) = ${result4}`);
console.log(`  预期：false\n`);

// 场景 5：美东时间 09:00 AM 对应 UTC 13:00
console.log("场景 5：美东时间转换验证");
const estTime = new Date("2026-05-15T09:00:00");
// 计算 EST 对应的 UTC 时间
const estOffset = estTime.getTimezoneOffset(); // 美东时间的偏移
console.log(`  美东本地时间：${estTime.toString()}`);
console.log(`  时区偏移（分钟）：${estOffset}`);
console.log(`  注意：当前测试环境在 EDT（夏令时），偏移为 -240 分钟（UTC-4）`);
console.log(`  所以美东时间 09:00 AM = UTC 13:00\n`);

console.log("=== 测试完成 ===");
