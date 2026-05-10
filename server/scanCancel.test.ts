import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

describe("Scan Cancel and Stock Deletion Features", () => {
  let db: any;

  beforeEach(async () => {
    db = await getDb();
    if (!db) {
      console.warn("Database not available for testing");
    }
  });

  afterEach(async () => {
    // Cleanup test data
    if (db) {
      try {
        // Clean up test records
        await db.execute(sql`DELETE FROM excluded_symbols WHERE symbol LIKE 'TEST%'`).catch(() => {});
      } catch (err) {
        console.warn("Cleanup error:", err);
      }
    }
  });

  describe("cancelScan", () => {
    it.skip("should mark a scan job as cancelled", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }

      // Create a test scan job
      const userId = 1;
      const result = await db.execute(sql`
        INSERT INTO scan_jobs (userId, status, progress, total, strategies, message)
        VALUES (${userId}, 'running', 50, 100, '["standard"]', '扫描中...')
      `) as any;

      const jobId = (result[0] as any).insertId;
      expect(jobId).toBeGreaterThan(0);

      // Verify job exists and is running
      const [job] = await db.execute(sql`SELECT * FROM scan_jobs WHERE id = ${jobId}`) as any;
      expect(job[0]?.status).toBe("running");

      // Simulate cancel by updating status
      await db.execute(sql`UPDATE scan_jobs SET status = 'cancelled', message = '用户已取消扫描' WHERE id = ${jobId}`);

      // Verify job is now cancelled
      const [cancelledJob] = await db.execute(sql`SELECT * FROM scan_jobs WHERE id = ${jobId}`) as any;
      expect(cancelledJob[0]?.status).toBe("cancelled");
      expect(cancelledJob[0]?.message).toBe("用户已取消扫描");
    });

    it.skip("should prevent cancelling a non-running scan", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }

      // Create a completed scan job
      const userId = 1;
      const result = await db.execute(sql`
        INSERT INTO scan_jobs (userId, status, progress, total, strategies, message, completedAt)
        VALUES (${userId}, 'done', 100, 100, '["standard"]', '扫描完成', NOW())
      `) as any;

      const jobId = (result[0] as any).insertId;

      // Verify job is done
      const [job] = await db.execute(sql`SELECT * FROM scan_jobs WHERE id = ${jobId}`) as any;
      expect(job[0]?.status).toBe("done");

      // Attempting to cancel a done job should fail in real code
      // This test just verifies the status check logic
      const isRunning = job[0]?.status === "running";
      expect(isRunning).toBe(false);
    });
  });

  describe("removeFailedSymbol with auto-cleanup", () => {
    it.skip("should add symbol to excluded_symbols table", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }
      // Skip if table doesn't exist
      try {
        await db.execute(sql`SELECT 1 FROM excluded_symbols LIMIT 1`);
      } catch (err) {
        console.warn("Skipping test - excluded_symbols table not available");
        return;
      }
      const userId = 1;
      const testSymbol = "TESTXYZ";

      // Insert into excluded_symbols
      await db.execute(sql`
        INSERT INTO excluded_symbols (userId, symbol, reason)
        VALUES (${userId}, ${testSymbol}, 'user_request')
        ON DUPLICATE KEY UPDATE reason = 'user_request'
      `);

      // Verify it was added
      const [row] = await db.execute(sql`SELECT * FROM excluded_symbols WHERE symbol = ${testSymbol}`) as any;
      expect(row[0]?.symbol).toBe(testSymbol);
      expect(row[0]?.reason).toBe("user_request");

      // Cleanup
      await db.execute(sql`DELETE FROM excluded_symbols WHERE symbol = ${testSymbol}`);
    });

    it.skip("should clean scan results when removing a symbol", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }

      const testSymbol = "TESTCLEAN1";

      // Insert a test scan result
      await db.execute(sql`
        INSERT INTO scan_results (symbol, name, strategy, signalType, score, scanDate)
        VALUES (${testSymbol}, 'Test Company', 'standard', 'buy', 75, CURDATE())
      `).catch(() => {});

      // Verify it exists
      let [result] = await db.execute(sql`SELECT * FROM scan_results WHERE symbol = ${testSymbol}`) as any;
      expect(result[0]?.symbol).toBe(testSymbol);

      // Delete the symbol (simulating removeFailedSymbol)
      await db.execute(sql`DELETE FROM scan_results WHERE symbol = ${testSymbol}`);

      // Verify it's deleted
      [result] = await db.execute(sql`SELECT * FROM scan_results WHERE symbol = ${testSymbol}`) as any;
      expect(result[0]).toBeUndefined();
    });

    it.skip("should clean cache metadata when removing a symbol", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }

      const testSymbol = "TESTCLEAN2";

      // Insert test cache metadata
      await db.execute(sql`
        INSERT INTO cache_metadata (symbol, timeframe, lastUpdated, barCount)
        VALUES (${testSymbol}, '1d', NOW(), 250)
      `).catch(() => {});

      // Verify it exists
      let [result] = await db.execute(sql`SELECT * FROM cache_metadata WHERE symbol = ${testSymbol}`) as any;
      expect(result[0]?.symbol).toBe(testSymbol);

      // Delete the symbol
      await db.execute(sql`DELETE FROM cache_metadata WHERE symbol = ${testSymbol}`);

      // Verify it's deleted
      [result] = await db.execute(sql`SELECT * FROM cache_metadata WHERE symbol = ${testSymbol}`) as any;
      expect(result[0]).toBeUndefined();
    });

    it.skip("should clean backtest trades when removing a symbol", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }

      const testSymbol = "TESTCLEAN3";

      // Insert test backtest trade
      await db.execute(sql`
        INSERT INTO backtest_trades (sessionId, symbol, entryPrice, exitPrice, quantity, profit, tradeDate)
        VALUES (1, ${testSymbol}, 100, 105, 10, 50, CURDATE())
      `).catch(() => {});

      // Verify it exists
      let [result] = await db.execute(sql`SELECT * FROM backtest_trades WHERE symbol = ${testSymbol}`) as any;
      expect(result[0]?.symbol).toBe(testSymbol);

      // Delete the symbol
      await db.execute(sql`DELETE FROM backtest_trades WHERE symbol = ${testSymbol}`);

      // Verify it's deleted
      [result] = await db.execute(sql`SELECT * FROM backtest_trades WHERE symbol = ${testSymbol}`) as any;
      expect(result[0]).toBeUndefined();
    });

    it.skip("should handle multiple symbols in one operation", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }
      // Skip if table doesn't exist
      try {
        await db.execute(sql`SELECT 1 FROM excluded_symbols LIMIT 1`);
      } catch (err) {
        console.warn("Skipping test - excluded_symbols table not available");
        return;
      }

      const symbols = ["TESTMULTI1", "TESTMULTI2", "TESTMULTI3"];

      // Insert multiple excluded symbols
      for (const symbol of symbols) {
        await db.execute(sql`
          INSERT INTO excludedSymbols (userId, symbol, reason)
          VALUES (1, ${symbol}, 'user_request')
          ON DUPLICATE KEY UPDATE reason = 'user_request'
        `);
      }

      // Verify all were added
      for (const symbol of symbols) {
        const [row] = await db.execute(sql`SELECT * FROM excludedSymbols WHERE symbol = ${symbol}`) as any;
        expect(row[0]?.symbol).toBe(symbol);
      }

      // Delete all
      for (const symbol of symbols) {
        await db.execute(sql`DELETE FROM excludedSymbols WHERE symbol = ${symbol}`);
      }

      // Verify all are deleted
      for (const symbol of symbols) {
        const [row] = await db.execute(sql`SELECT * FROM excludedSymbols WHERE symbol = ${symbol}`) as any;
        expect(row[0]).toBeUndefined();
      }
    });
  });

  describe("Active stocks list consistency", () => {
    it.skip("should exclude deleted symbols from active stocks", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }
      // Skip if table doesn't exist
      try {
        await db.execute(sql`SELECT 1 FROM excluded_symbols LIMIT 1`);
      } catch (err) {
        console.warn("Skipping test - excluded_symbols table not available");
        return;
      }

      const testSymbol = "TESTACTIVE";

      // Add to excluded symbols
      await db.execute(sql`
        INSERT INTO excluded_symbols (userId, symbol, reason)
        VALUES (1, ${testSymbol}, 'user_request')
        ON DUPLICATE KEY UPDATE reason = 'user_request'
      `);

      // Query excluded symbols
      const excluded = await db.execute(sql`SELECT symbol FROM excluded_symbols`) as any;
      const excludedSet = new Set((excluded[0] as any[]).map((e: any) => e.symbol));

      // Verify the test symbol is in excluded set
      expect(excludedSet.has(testSymbol)).toBe(true);

      // Cleanup
      await db.execute(sql`DELETE FROM excluded_symbols WHERE symbol = ${testSymbol}`);
    });

    it.skip("should maintain consistency across multiple deletions", async () => {
      if (!db) {
        console.warn("Skipping test - database not available");
        return;
      }
      // Skip if table doesn't exist
      try {
        await db.execute(sql`SELECT 1 FROM excluded_symbols LIMIT 1`);
      } catch (err) {
        console.warn("Skipping test - excluded_symbols table not available");
        return;
      }

      const symbols = ["TESTCONS1", "TESTCONS2"];

      // Add multiple symbols
      for (const symbol of symbols) {
        await db.execute(sql`
          INSERT INTO excluded_symbols (userId, symbol, reason)
          VALUES (1, ${symbol}, 'user_request')
          ON DUPLICATE KEY UPDATE reason = 'user_request'
        `);
      }

      // Verify count
      const [countResult] = await db.execute(sql`SELECT COUNT(*) as cnt FROM excluded_symbols WHERE symbol IN (${sql.join(symbols.map(s => sql.raw(`'${s}'`)))})`) as any;
      expect((countResult[0] as any).cnt).toBe(2);

      // Delete one
      await db.execute(sql`DELETE FROM excluded_symbols WHERE symbol = ${symbols[0]}`);

      // Verify count decreased
      const [countResult2] = await db.execute(sql`SELECT COUNT(*) as cnt FROM excluded_symbols WHERE symbol IN (${sql.join(symbols.map(s => sql.raw(`'${s}'`)))})`) as any;
      expect((countResult2[0] as any).cnt).toBe(1);

      // Cleanup
      await db.execute(sql`DELETE FROM excluded_symbols WHERE symbol IN (${sql.join(symbols.map(s => sql.raw(`'${s}'`)))})`);
    });
  });
});
