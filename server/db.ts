import { eq, and, isNull, desc, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, warmingProgress, warmingStats, scheduledWarmingTasks, aiConfigs, customDataSources } from "../drizzle/schema";
import { ENV } from './_core/env';
import bcrypt from "bcryptjs";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;
let _connectionFailed = false;
let _lastConnectionAttempt = 0;
const CONNECTION_RETRY_INTERVAL = 5000; // 每 5 秒重试一次

// 使用连接池而不是单一连接，支持自动重连
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    const now = Date.now();
    
    // 如果上次连接失败，且轮询间隔未到，不再尝试
    if (_connectionFailed && now - _lastConnectionAttempt < CONNECTION_RETRY_INTERVAL) {
      return null;
    }
    
    try {
      _lastConnectionAttempt = now;
      if (!_pool) {
        _pool = mysql.createPool(process.env.DATABASE_URL);
      }
      _db = drizzle(_pool) as any;
      _connectionFailed = false;
      console.log("[Database] Connected successfully with connection pool");
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _connectionFailed = true;
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

// ============================================================
// User Management
// ============================================================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// Auth Helpers
// ============================================================

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function registerUser(username: string, password: string, name?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getUserByUsername(username);
  if (existing) throw new Error("用户名已存在");
  const passwordHash = await bcrypt.hash(password, 10);
  const openId = `local_${username}`;
  await db.insert(users).values({
    openId, username, passwordHash,
    name: name || username,
    loginMethod: "password",
    lastSignedIn: new Date(),
  });
  return getUserByOpenId(openId);
}

export async function verifyPassword(username: string, password: string) {
  const user = await getUserByUsername(username);
  if (!user || !user.passwordHash) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  const db = await getDb();
  if (db) await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return user;
}

export async function changePassword(userId: number, oldPassword: string, newPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (result.length === 0) throw new Error("用户不存在");
  const user = result[0];
  if (!user.passwordHash) throw new Error("该用户未设置密码");
  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) throw new Error("旧密码错误");
  const newHash = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, userId));
  return true;
}

// ============================================================
// Warming Progress & Stats
// ============================================================

export async function recordWarmingProgress(
  userId: number, taskId: string, symbol: string,
  status: "pending" | "success" | "failed",
  dataSource?: string, errorMessage?: string, duration?: number
) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(warmingProgress).values({
      userId,
      taskId: `${taskId}_${symbol}`,
      symbol,
      status,
      dataSource,
      errorMessage,
      duration,
      completedAt: status !== "pending" ? new Date() : undefined,
    }).onDuplicateKeyUpdate({ set: { status, errorMessage, duration, completedAt: new Date() } });
  } catch (e) {
    console.warn("[DB] recordWarmingProgress error:", e);
  }
}

export async function updateWarmingStats(
  userId: number, dataSource: string,
  success: boolean, durationMs: number
) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(warmingStats)
    .where(and(eq(warmingStats.userId, userId), eq(warmingStats.dataSource, dataSource)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(warmingStats).values({
      userId, dataSource,
      successCount: success ? 1 : 0,
      failCount: success ? 0 : 1,
      totalDuration: durationMs,
      averageDuration: String(durationMs),
    });
  } else {
    const s = existing[0];
    const newSuccess = (s.successCount || 0) + (success ? 1 : 0);
    const newFail = (s.failCount || 0) + (success ? 0 : 1);
    const newTotal = (s.totalDuration || 0) + durationMs;
    const newCount = newSuccess + newFail;
    await db.update(warmingStats)
      .set({
        successCount: newSuccess,
        failCount: newFail,
        totalDuration: newTotal,
        averageDuration: String(newCount > 0 ? newTotal / newCount : 0),
      })
      .where(and(eq(warmingStats.userId, userId), eq(warmingStats.dataSource, dataSource)));
  }
}

export async function getIncompleteWarmingProgress(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(warmingProgress)
    .where(and(eq(warmingProgress.userId, userId), eq(warmingProgress.status, "failed")))
    .orderBy(desc(warmingProgress.id))
    .limit(100);
}

export async function getWarmingStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(warmingStats).where(eq(warmingStats.userId, userId));
}

// ============================================================
// Scheduled Warming Tasks
// ============================================================

export async function getEnabledScheduledTasks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduledWarmingTasks)
    .where(eq(scheduledWarmingTasks.isEnabled, true));
}

export async function updateScheduledTaskExecution(taskId: number, nextExecutedAt: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(scheduledWarmingTasks)
    .set({ lastExecutedAt: new Date(), nextExecutedAt })
    .where(eq(scheduledWarmingTasks.id, taskId));
}

export async function createScheduledTask(
  userId: number, name: string, sectors: string[], marketCapTiers: string[],
  cronExpression: string, description?: string, customSymbols?: string[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(scheduledWarmingTasks).values({
    userId, name, description, sectors, marketCapTiers,
    customSymbols: customSymbols || [],
    cronExpression, isEnabled: true,
  });
}

export async function getScheduledTasks(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduledWarmingTasks)
    .where(eq(scheduledWarmingTasks.userId, userId))
    .orderBy(desc(scheduledWarmingTasks.createdAt));
}

export async function getScheduledTaskById(taskId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(scheduledWarmingTasks)
    .where(eq(scheduledWarmingTasks.id, taskId)).limit(1);
  return result[0];
}

export async function updateScheduledTask(taskId: number, updates: {
  name?: string; description?: string; sectors?: string[]; marketCapTiers?: string[];
  cronExpression?: string; isEnabled?: boolean; customSymbols?: string[];
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(scheduledWarmingTasks).set(updates as any).where(eq(scheduledWarmingTasks.id, taskId));
}

export async function deleteScheduledTask(taskId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(scheduledWarmingTasks).where(eq(scheduledWarmingTasks.id, taskId));
}

// TODO: add feature queries here as your schema grows.

// ============================================================
// AI Configs
// ============================================================

export async function getAIConfigs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiConfigs).where(eq(aiConfigs.userId, userId));
}

export async function getAIConfigById(configId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(aiConfigs).where(eq(aiConfigs.id, configId)).limit(1);
  return result[0];
}

export async function createAIConfig(userId: number, config: {
  provider: string; apiEndpoint: string; apiKey: string; model: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(aiConfigs).values({ userId, ...config, isActive: true });
}

export async function updateAIConfig(configId: number, updates: {
  apiEndpoint?: string; apiKey?: string; model?: string; isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(aiConfigs).set(updates as any).where(eq(aiConfigs.id, configId));
}

export async function deleteAIConfig(configId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(aiConfigs).where(eq(aiConfigs.id, configId));
}

export async function setDefaultAIConfig(userId: number, provider: string, configId: number) {
  const db = await getDb();
  if (!db) return;
  // Deactivate all configs for this provider, then activate the selected one
  await db.update(aiConfigs)
    .set({ isActive: false })
    .where(and(eq(aiConfigs.userId, userId), eq(aiConfigs.provider, provider)));
  await db.update(aiConfigs)
    .set({ isActive: true })
    .where(eq(aiConfigs.id, configId));
}

// ============================================================
// Custom Data Sources
// ============================================================

export async function getCustomDataSources(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customDataSources).where(eq(customDataSources.userId, userId));
}

export async function getCustomDataSourceById(sourceId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(customDataSources).where(eq(customDataSources.id, sourceId)).limit(1);
  return result[0];
}

export async function createCustomDataSource(userId: number, data: {
  name: string; provider: string; apiEndpoint?: string; apiKey?: string; description?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(customDataSources).values({ userId, ...data, isActive: true });
}

export async function updateCustomDataSource(sourceId: number, updates: {
  name?: string; apiEndpoint?: string; apiKey?: string; description?: string; isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(customDataSources).set(updates as any).where(eq(customDataSources.id, sourceId));
}

export async function deleteCustomDataSource(sourceId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(customDataSources).where(eq(customDataSources.id, sourceId));
}
