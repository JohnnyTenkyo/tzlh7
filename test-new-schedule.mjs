#!/usr/bin/env node

/**
 * 测试脚本：验证新的定时任务执行时间
 * - 全量扫描：UTC 10:00（美东时间 06:00 AM）
 * - K 线缓存预热：UTC 12:00（美东时间 08:00 AM）
 */

function shouldRunDailyTask(hour, lastRunDate, testNow) {
  const now = testNow || new Date();
  const currentHour = now.getUTCHours();
  const currentDate = now.getUTCDate();
  const currentMonth = now.getUTCMonth();
  const currentYear = now.getUTCFullYear();

  if (currentHour !== hour) return false;

  if (lastRunDate) {
    const lastRunDateUTC = lastRunDate.getUTCDate();
    const lastRunMonthUTC = lastRunDate.getUTCMonth();
    const lastRunYearUTC = lastRunDate.getUTCFullYear();
    
    if (lastRunYearUTC === currentYear && lastRunMonthUTC === currentMonth && lastRunDateUTC === currentDate) {
      return false;
    }
  }

  return true;
}

console.log("=== 新的定时任务执行时间验证 ===\n");

// 测试时间：美东时间 06:00 AM = UTC 10:00
const scanTime = new Date("2026-05-16T10:00:00Z");
console.log("全量扫描任务");
console.log(`  计划执行时间：UTC 10:00（美东时间 06:00 AM）`);
console.log(`  测试时间：${scanTime.toISOString()}`);
console.log(`  本地时间：${scanTime.toString()}`);
console.log(`  shouldRunDailyTask(10, null) = ${shouldRunDailyTask(10, null, scanTime)}`);
console.log(`  预期：true\n`);

// 测试时间：美东时间 08:00 AM = UTC 12:00
const cacheTime = new Date("2026-05-16T12:00:00Z");
console.log("K 线缓存预热任务");
console.log(`  计划执行时间：UTC 12:00（美东时间 08:00 AM）`);
console.log(`  测试时间：${cacheTime.toISOString()}`);
console.log(`  本地时间：${cacheTime.toString()}`);
console.log(`  shouldRunDailyTask(12, null) = ${shouldRunDailyTask(12, null, cacheTime)}`);
console.log(`  预期：true\n`);

// 验证不同时间不会触发
console.log("不应该触发的时间");
const wrongTime = new Date("2026-05-16T11:00:00Z");
console.log(`  测试时间：${wrongTime.toISOString()}（UTC 11:00）`);
console.log(`  shouldRunDailyTask(10, null) = ${shouldRunDailyTask(10, null, wrongTime)}`);
console.log(`  shouldRunDailyTask(12, null) = ${shouldRunDailyTask(12, null, wrongTime)}`);
console.log(`  预期：都是 false\n`);

// 验证同一天不会重复执行
console.log("同一天重复执行检查");
const lastRun = new Date("2026-05-16T10:05:00Z");
const sameDay = new Date("2026-05-16T10:30:00Z");
console.log(`  上次执行时间：${lastRun.toISOString()}`);
console.log(`  当前时间：${sameDay.toISOString()}`);
console.log(`  shouldRunDailyTask(10, lastRun) = ${shouldRunDailyTask(10, lastRun, sameDay)}`);
console.log(`  预期：false\n`);

// 验证不同天会重新执行
console.log("不同天重新执行检查");
const nextDay = new Date("2026-05-17T10:00:00Z");
console.log(`  上次执行时间：${lastRun.toISOString()}`);
console.log(`  当前时间：${nextDay.toISOString()}`);
console.log(`  shouldRunDailyTask(10, lastRun) = ${shouldRunDailyTask(10, lastRun, nextDay)}`);
console.log(`  预期：true\n`);

console.log("=== 验证完成 ===");
