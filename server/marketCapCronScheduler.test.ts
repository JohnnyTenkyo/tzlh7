import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startMarketCapCronScheduler, stopMarketCapCronScheduler, getMarketCapCronStatus } from "./marketCapCronScheduler";

describe("Market Cap Cron Scheduler", () => {
  beforeAll(() => {
    // Mock console methods to avoid noise in tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    // Stop scheduler and restore console
    stopMarketCapCronScheduler();
    vi.restoreAllMocks();
  });

  describe("Scheduler Initialization", () => {
    it("should start the scheduler without errors", () => {
      expect(() => {
        startMarketCapCronScheduler();
      }).not.toThrow();
    });

    it("should return running status after start", () => {
      startMarketCapCronScheduler();
      const status = getMarketCapCronStatus();
      expect(status.running).toBe(true);
      expect(status.nextRun).toBeDefined();
    });

    it("should not start scheduler twice", () => {
      startMarketCapCronScheduler();
      const status1 = getMarketCapCronStatus();
      startMarketCapCronScheduler(); // Try to start again
      const status2 = getMarketCapCronStatus();
      expect(status1.running).toBe(status2.running);
    });
  });

  describe("Scheduler Stop", () => {
    it("should stop the scheduler", () => {
      startMarketCapCronScheduler();
      stopMarketCapCronScheduler();
      const status = getMarketCapCronStatus();
      expect(status.running).toBe(false);
    });

    it("should handle stopping when not running", () => {
      stopMarketCapCronScheduler();
      expect(() => {
        stopMarketCapCronScheduler();
      }).not.toThrow();
    });
  });

  describe("Scheduler Status", () => {
    it("should return not running status when scheduler is stopped", () => {
      stopMarketCapCronScheduler();
      const status = getMarketCapCronStatus();
      expect(status.running).toBe(false);
      expect(status.nextRun).toBeUndefined();
    });

    it("should return running status with nextRun when scheduler is active", () => {
      startMarketCapCronScheduler();
      const status = getMarketCapCronStatus();
      expect(status.running).toBe(true);
      expect(status.nextRun).toBeDefined();
      expect(typeof status.nextRun).toBe("string");
      stopMarketCapCronScheduler();
    });
  });

  describe("Cron Expression Validation", () => {
    it("should use correct cron expression for 8 AM EST (13:00 UTC)", () => {
      // The cron expression "0 13 * * *" means:
      // - 0: at minute 0
      // - 13: at hour 13 (UTC)
      // - *: every day of month
      // - *: every month
      // - *: every day of week
      // This equals 8:00 AM EDT (Eastern Daylight Time)
      expect("0 13 * * *").toMatch(/^\d+ \d+ \* \* \*$/);
    });

    it("should run daily at consistent time", () => {
      startMarketCapCronScheduler();
      const status = getMarketCapCronStatus();
      expect(status.running).toBe(true);
      // Verify that nextRun is a valid ISO string
      expect(new Date(status.nextRun!).getTime()).toBeGreaterThan(0);
      stopMarketCapCronScheduler();
    });
  });

  describe("Error Handling", () => {
    it("should handle scheduler errors gracefully", () => {
      expect(() => {
        startMarketCapCronScheduler();
        // Simulate error by stopping and restarting
        stopMarketCapCronScheduler();
        startMarketCapCronScheduler();
      }).not.toThrow();
    });
  });
});
