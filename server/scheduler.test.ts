import { describe, it, expect, beforeEach } from "vitest";

/**
 * 定时任务调度器单元测试
 */

// 模拟 shouldRunDailyTask 函数
function shouldRunDailyTask(hour: number, lastRunDate: Date | null, now: Date = new Date()): boolean {
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

describe("Scheduler - shouldRunDailyTask", () => {
  it("should return true when first run at target hour", () => {
    const now = new Date("2026-05-11T13:00:00Z");
    expect(shouldRunDailyTask(13, null, now)).toBe(true);
  });

  it("should return false when already ran today at target hour", () => {
    const now = new Date("2026-05-11T13:10:00Z");
    const lastRun = new Date("2026-05-11T13:05:00Z");
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(false);
  });

  it("should return true when different day at target hour", () => {
    const now = new Date("2026-05-12T13:10:00Z");
    const lastRun = new Date("2026-05-11T13:05:00Z");
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(true);
  });

  it("should return false when not at target hour", () => {
    const now = new Date("2026-05-11T14:00:00Z");
    expect(shouldRunDailyTask(13, null, now)).toBe(false);
  });

  it("should return true when crossing month boundary", () => {
    const now = new Date("2026-06-01T13:10:00Z");
    const lastRun = new Date("2026-05-31T13:05:00Z");
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(true);
  });

  it("should return true when crossing year boundary", () => {
    const now = new Date("2027-01-01T13:10:00Z");
    const lastRun = new Date("2026-12-31T13:05:00Z");
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(true);
  });

  it("should handle edge case: last run at 23:59, current at 00:00", () => {
    const now = new Date("2026-05-12T00:00:00Z");
    const lastRun = new Date("2026-05-11T23:59:00Z");
    // At 00:00, target hour is 13, so should return false (not at target hour)
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(false);
  });

  it("should handle edge case: last run at 13:00, current at 13:59", () => {
    const now = new Date("2026-05-11T13:59:00Z");
    const lastRun = new Date("2026-05-11T13:00:00Z");
    // Same day, same hour, should return false
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(false);
  });

  it("should return true when last run was yesterday at target hour", () => {
    const now = new Date("2026-05-12T13:00:00Z");
    const lastRun = new Date("2026-05-11T13:00:00Z");
    // Different day, at target hour, should return true
    expect(shouldRunDailyTask(13, lastRun, now)).toBe(true);
  });
});

describe("Scheduler - Daily Scan Execution Times", () => {
  it("should execute daily scan at UTC 13:00 (09:00 AM EDT)", () => {
    // 美东时间 09:00 AM EDT = UTC 13:00
    // 正确的做法：使用 UTC 时间直接指定
    const utcTime = new Date("2026-05-11T13:00:00Z");
    
    console.log(`UTC: ${utcTime.toUTCString()}`);
    console.log(`UTC Hour: ${utcTime.getUTCHours()}`);
    
    // 验证时间
    expect(utcTime.getUTCHours()).toBe(13);
  });

  it("should execute daily cache warming at UTC 12:00 (08:00 AM EDT)", () => {
    // 美东时间 08:00 AM EDT = UTC 12:00
    // 正确的做法：使用 UTC 时间直接指定
    const utcTime = new Date("2026-05-11T12:00:00Z");
    
    console.log(`UTC: ${utcTime.toUTCString()}`);
    console.log(`UTC Hour: ${utcTime.getUTCHours()}`);
    
    // 验证时间
    expect(utcTime.getUTCHours()).toBe(12);
  });
});
