import { describe, it, expect } from 'vitest';
import { getMarketCapCronStatus, getMarketCapCronLogs } from './marketCapCronScheduler';

/**
 * Cron Logging Tests
 * 
 * These tests verify that the cron scheduler properly logs execution history
 * and provides status information including next run time and last execution details.
 */

describe('Cron Logging and Status', () => {
  describe('Cron Status Retrieval', () => {
    it('should return status object', () => {
      const status = getMarketCapCronStatus();
      
      expect(status).toBeDefined();
      expect(status.running).toBeDefined();
    });

    it('should calculate next run time correctly when running', () => {
      const status = getMarketCapCronStatus();
      
      if (status.running) {
        expect(status.nextRun).toBeDefined();
        expect(status.nextRun).toBeTruthy();
        
        // Verify it's a valid ISO string
        const nextRunDate = new Date(status.nextRun!);
        expect(nextRunDate.getTime()).toBeGreaterThan(Date.now());
      }
    });

    it('should have nextRun at 13:00 UTC when running', () => {
      const status = getMarketCapCronStatus();
      
      if (status.running && status.nextRun) {
        const nextRunDate = new Date(status.nextRun);
        
        // Should be at 13:00 UTC (hour 13)
        expect(nextRunDate.getUTCHours()).toBe(13);
        expect(nextRunDate.getUTCMinutes()).toBe(0);
        expect(nextRunDate.getUTCSeconds()).toBe(0);
      }
    });

    it('should schedule for tomorrow if 13:00 UTC has passed today', () => {
      const status = getMarketCapCronStatus();
      
      if (status.running && status.nextRun) {
        const nextRunDate = new Date(status.nextRun);
        const now = new Date();
        
        // If we're past 13:00 UTC today, nextRun should be tomorrow
        if (now.getUTCHours() > 13 || (now.getUTCHours() === 13 && now.getUTCMinutes() > 0)) {
          expect(nextRunDate.getUTCDate()).toBeGreaterThan(now.getUTCDate());
        }
      }
    });

    it('should include last execution log if available', () => {
      const status = getMarketCapCronStatus();
      
      // lastExecution may be undefined if no execution has occurred yet
      if (status.lastExecution) {
        expect(status.lastExecution.timestamp).toBeDefined();
        expect(status.lastExecution.status).toMatch(/^(success|failure)$/);
      }
    });
  });

  describe('Cron Logs Retrieval', () => {
    it('should return an array of execution logs', () => {
      const logs = getMarketCapCronLogs();
      
      expect(Array.isArray(logs)).toBe(true);
    });

    it('should respect the limit parameter', () => {
      const logs5 = getMarketCapCronLogs(5);
      const logs10 = getMarketCapCronLogs(10);
      
      expect(logs5.length).toBeLessThanOrEqual(5);
      expect(logs10.length).toBeLessThanOrEqual(10);
    });

    it('should return logs in reverse chronological order (newest first)', () => {
      const logs = getMarketCapCronLogs(10);
      
      if (logs.length > 1) {
        for (let i = 0; i < logs.length - 1; i++) {
          const current = new Date(logs[i].timestamp).getTime();
          const next = new Date(logs[i + 1].timestamp).getTime();
          
          // Current should be >= next (reverse order)
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });

    it('should include required fields for success logs', () => {
      const logs = getMarketCapCronLogs(30);
      const successLogs = logs.filter(log => log.status === 'success');
      
      successLogs.forEach(log => {
        expect(log.timestamp).toBeDefined();
        expect(log.status).toBe('success');
        expect(log.successCount).toBeDefined();
        expect(log.failureCount).toBeDefined();
        expect(log.totalCount).toBeDefined();
      });
    });

    it('should include required fields for failure logs', () => {
      const logs = getMarketCapCronLogs(30);
      const failureLogs = logs.filter(log => log.status === 'failure');
      
      failureLogs.forEach(log => {
        expect(log.timestamp).toBeDefined();
        expect(log.status).toBe('failure');
        expect(log.errorMessage).toBeDefined();
      });
    });

    it('should have valid timestamp format (ISO 8601)', () => {
      const logs = getMarketCapCronLogs(10);
      
      logs.forEach(log => {
        const date = new Date(log.timestamp);
        expect(date.getTime()).toBeGreaterThan(0);
        expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });
    });

    it('should handle default limit of 10', () => {
      const logs = getMarketCapCronLogs();
      
      expect(logs.length).toBeLessThanOrEqual(10);
    });

    it('should handle large limit gracefully', () => {
      const logs = getMarketCapCronLogs(1000);
      
      // Should not exceed MAX_LOG_ENTRIES (30)
      expect(logs.length).toBeLessThanOrEqual(30);
    });
  });

  describe('Cron Status Integration', () => {
    it('should provide consistent status information', () => {
      const status1 = getMarketCapCronStatus();
      const status2 = getMarketCapCronStatus();
      
      expect(status1.running).toBe(status2.running);
    });

    it('should have nextRun in the future when running', () => {
      const status = getMarketCapCronStatus();
      
      if (status.running && status.nextRun) {
        const nextRunTime = new Date(status.nextRun).getTime();
        const now = Date.now();
        
        expect(nextRunTime).toBeGreaterThan(now);
      }
    });

    it('should have nextRun within 24 hours when running', () => {
      const status = getMarketCapCronStatus();
      
      if (status.running && status.nextRun) {
        const nextRunTime = new Date(status.nextRun).getTime();
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        expect(nextRunTime - now).toBeLessThan(oneDayMs);
      }
    });
  });
});
