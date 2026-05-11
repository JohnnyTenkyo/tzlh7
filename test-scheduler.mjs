#!/usr/bin/env node

/**
 * 测试脚本：验证定时任务的时间检查逻辑
 */

// 模拟 shouldRunDailyTask 函数
function shouldRunDailyTask(hour, lastRunDate, now = new Date()) {
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

// 测试场景
console.log("=== 定时任务时间检查测试 ===\n");

// 场景 1：首次运行，时间正好是 14:00
const now1 = new Date("2026-05-11T14:00:00Z");
console.log(`场景 1: 首次运行，时间 ${now1.toISOString()}`);
console.log(`  shouldRunDailyTask(14, null) = ${shouldRunDailyTask(14, null, now1)}`);
console.log(`  预期: true\n`);

// 场景 2：同一天，已经运行过，时间仍在 14:00
const lastRun2 = new Date("2026-05-11T14:05:00Z");
const now2 = new Date("2026-05-11T14:10:00Z");
console.log(`场景 2: 同一天，已运行过，时间 ${now2.toISOString()}`);
console.log(`  lastRunDate: ${lastRun2.toISOString()}`);
console.log(`  shouldRunDailyTask(14, lastRun2) = ${shouldRunDailyTask(14, lastRun2, now2)}`);
console.log(`  预期: false\n`);

// 场景 3：不同天，时间是 14:00
const lastRun3 = new Date("2026-05-10T14:05:00Z");
const now3 = new Date("2026-05-11T14:10:00Z");
console.log(`场景 3: 不同天，时间 ${now3.toISOString()}`);
console.log(`  lastRunDate: ${lastRun3.toISOString()}`);
console.log(`  shouldRunDailyTask(14, lastRun3) = ${shouldRunDailyTask(14, lastRun3, now3)}`);
console.log(`  预期: true\n`);

// 场景 4：时间不是 14:00
const now4 = new Date("2026-05-11T15:00:00Z");
console.log(`场景 4: 时间不是 14:00，时间 ${now4.toISOString()}`);
console.log(`  shouldRunDailyTask(14, null) = ${shouldRunDailyTask(14, null, now4)}`);
console.log(`  预期: false\n`);

// 场景 5：跨月份，时间是 14:00
const lastRun5 = new Date("2026-04-30T14:05:00Z");
const now5 = new Date("2026-05-01T14:10:00Z");
console.log(`场景 5: 跨月份，时间 ${now5.toISOString()}`);
console.log(`  lastRunDate: ${lastRun5.toISOString()}`);
console.log(`  shouldRunDailyTask(14, lastRun5) = ${shouldRunDailyTask(14, lastRun5, now5)}`);
console.log(`  预期: true\n`);

console.log("=== 测试完成 ===");
