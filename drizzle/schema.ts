import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  bigint,
  json,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/mysql-core";

// ============================================================
// Users
// ============================================================
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// Backtest Sessions
// ============================================================
export const backtestSessions = mysqlTable("backtest_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  strategy: mysqlEnum("strategy", ["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "gemini_ai", "vamr", "ravts", "rsi_reversal", "macd_divergence"]).notNull(),
  strategyParams: json("strategyParams").$type<Record<string, any>>(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  symbols: json("symbols").$type<string[]>().notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(),
  endDate: varchar("endDate", { length: 10 }).notNull(),
  initialCapital: decimal("initialCapital", { precision: 15, scale: 2 }).default("100000").notNull(),
  maxPositionPct: decimal("maxPositionPct", { precision: 5, scale: 2 }).default("10").notNull(),
  totalReturn: decimal("totalReturn", { precision: 15, scale: 4 }),
  totalReturnPct: decimal("totalReturnPct", { precision: 10, scale: 4 }),
  winRate: decimal("winRate", { precision: 5, scale: 4 }),
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 4 }),
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  totalTrades: int("totalTrades"),
  winningTrades: int("winningTrades"),
  losingTrades: int("losingTrades"),
  benchmarkReturn: decimal("benchmarkReturn", { precision: 10, scale: 4 }),
  totalCommissionFee: decimal("totalCommissionFee", { precision: 15, scale: 2 }).default("0"),
  totalPlatformFee: decimal("totalPlatformFee", { precision: 15, scale: 2 }).default("0"),
  progress: int("progress").default(0),
  progressMessage: text("progressMessage"),
  resultSummary: json("resultSummary"),
  aiAnalysis: text("aiAnalysis"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type BacktestSession = typeof backtestSessions.$inferSelect;

// ============================================================
// Backtest Trades
// ============================================================
export const backtestTrades = mysqlTable("backtest_trades", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
  price: decimal("price", { precision: 15, scale: 4 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 15, scale: 2 }).notNull(),
  fee: decimal("fee", { precision: 10, scale: 4 }).default("0"),
  commissionFee: decimal("commissionFee", { precision: 15, scale: 2 }).default("0"),
  platformFee: decimal("platformFee", { precision: 15, scale: 2 }).default("0"),
  reason: text("reason"),
  signalType: varchar("signalType", { length: 50 }),
  tradeTime: bigint("tradeTime", { mode: "number" }).notNull(),
  pnl: decimal("pnl", { precision: 15, scale: 2 }),
  pnlPct: decimal("pnlPct", { precision: 10, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_session").on(table.sessionId),
]);

// ============================================================
// Historical Candle Cache
// ============================================================
export const historicalCandleCache = mysqlTable("historical_candle_cache", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  date: varchar("date", { length: 30 }).notNull(),
  open: decimal("open", { precision: 15, scale: 4 }).notNull(),
  high: decimal("high", { precision: 15, scale: 4 }).notNull(),
  low: decimal("low", { precision: 15, scale: 4 }).notNull(),
  close: decimal("close", { precision: 15, scale: 4 }).notNull(),
  volume: bigint("volume", { mode: "number" }).default(0),
}, (table) => [
  uniqueIndex("idx_symbol_tf_date").on(table.symbol, table.timeframe, table.date),
  index("idx_symbol_tf").on(table.symbol, table.timeframe),
]);

// ============================================================
// Cache Metadata
// ============================================================
export const cacheMetadata = mysqlTable("cache_metadata", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  oldestDate: varchar("oldestDate", { length: 30 }),
  newestDate: varchar("newestDate", { length: 30 }),
  candleCount: int("candleCount").default(0),
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow(),
  status: mysqlEnum("status", ["empty", "partial", "complete"]).default("empty"),
}, (table) => [
  uniqueIndex("idx_cm_symbol_tf").on(table.symbol, table.timeframe),
]);

// ============================================================
// Data Source Health
// ============================================================
export const dataSourceHealth = mysqlTable("data_source_health", {
  id: int("id").autoincrement().primaryKey(),
  source: varchar("source", { length: 30 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  successCount: int("successCount").default(0),
  failCount: int("failCount").default(0),
  lastSuccess: timestamp("lastSuccess"),
  lastFail: timestamp("lastFail"),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => [
  uniqueIndex("idx_dsh_source_tf").on(table.source, table.timeframe),
]);

// ============================================================
// Warming Progress (缓存预热进度跟踪)
// ============================================================
export const warmingProgress = mysqlTable("warming_progress", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  taskId: varchar("taskId", { length: 64 }).notNull().unique(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  status: mysqlEnum("status", ["pending", "success", "failed"]).default("pending").notNull(),
  dataSource: varchar("dataSource", { length: 30 }),
  errorMessage: text("errorMessage"),
  duration: int("duration"), // milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_task_id").on(table.taskId),
  index("idx_user_id").on(table.userId),
  index("idx_status").on(table.status),
]);

export type WarmingProgress = typeof warmingProgress.$inferSelect;
export type InsertWarmingProgress = typeof warmingProgress.$inferInsert;

// ============================================================
// Warming Stats (缓存预热统计数据)
// ============================================================
export const warmingStats = mysqlTable("warming_stats", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  dataSource: varchar("dataSource", { length: 30 }).notNull(),
  successCount: int("successCount").default(0),
  failCount: int("failCount").default(0),
  totalDuration: bigint("totalDuration", { mode: "number" }).default(0), // total milliseconds
  averageDuration: decimal("averageDuration", { precision: 10, scale: 2 }).default("0"), // milliseconds
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow(),
}, (table) => [
  uniqueIndex("idx_user_source").on(table.userId, table.dataSource),
]);

export type WarmingStats = typeof warmingStats.$inferSelect;
export type InsertWarmingStats = typeof warmingStats.$inferInsert;

// ============================================================
// Scheduled Warming Tasks (定时预热任务)
// ============================================================
export const scheduledWarmingTasks = mysqlTable("scheduled_warming_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  sectors: json("sectors").$type<string[]>(), // selected sectors
  marketCapTiers: json("marketCapTiers").$type<string[]>(), // selected market cap tiers
  customSymbols: json("customSymbols").$type<string[]>(), // custom symbol list
  cronExpression: varchar("cronExpression", { length: 100 }).notNull(), // e.g., "0 2 * * *" for 2 AM daily
  isEnabled: boolean("isEnabled").default(true),
  lastExecutedAt: timestamp("lastExecutedAt"),
  nextExecutedAt: timestamp("nextExecutedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => [
  index("idx_user_id").on(table.userId),
  index("idx_enabled").on(table.isEnabled),
  index("idx_next_executed").on(table.nextExecutedAt),
]);

export type ScheduledWarmingTask = typeof scheduledWarmingTasks.$inferSelect;
export type InsertScheduledWarmingTask = typeof scheduledWarmingTasks.$inferInsert;

// ============================================================
// AI Configurations (用户级别 AI 配置)
// ============================================================
export const aiConfigs = mysqlTable("ai_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 50 }).notNull(), // "gemini", "openai", "custom", etc.
  apiEndpoint: varchar("apiEndpoint", { length: 500 }).notNull(), // API base URL
  apiKey: varchar("apiKey", { length: 500 }).notNull(), // encrypted API key
  model: varchar("model", { length: 100 }).notNull(), // model name (e.g., "gpt-4", "gemini-pro")
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => [
  uniqueIndex("idx_user_provider").on(table.userId, table.provider),
  index("idx_user_active").on(table.userId, table.isActive),
]);
export type AIConfig = typeof aiConfigs.$inferSelect;
export type InsertAIConfig = typeof aiConfigs.$inferInsert;

// ============================================================
// Excluded Symbols (排除股票 - 删除失败/退市股票)
// ============================================================
export const excludedSymbols = mysqlTable("excluded_symbols", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  reason: varchar("reason", { length: 100 }), // "delisted", "renamed", "user_request", etc.
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_user_symbol").on(table.userId, table.symbol),
  index("idx_user_id").on(table.userId),
]);

export type ExcludedSymbol = typeof excludedSymbols.$inferSelect;
export type InsertExcludedSymbol = typeof excludedSymbols.$inferInsert;

// ============================================================
// Custom Data Sources (用户自定义数据源配置)
// ============================================================
export const customDataSources = mysqlTable("custom_data_sources", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(), // e.g., "My Custom Source"
  provider: varchar("provider", { length: 50 }).notNull(), // e.g., "custom_api", "csv_upload", etc.
  apiEndpoint: varchar("apiEndpoint", { length: 500 }), // API base URL (if applicable)
  apiKey: varchar("apiKey", { length: 500 }), // encrypted API key (if applicable)
  description: text("description"), // user notes
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => [
  index("idx_user_id").on(table.userId),
  index("idx_user_active").on(table.userId, table.isActive),
]);

export type CustomDataSource = typeof customDataSources.$inferSelect;
export type InsertCustomDataSource = typeof customDataSources.$inferInsert;

// ============================================================
// Scan Results (今日信号全量扫描结果缓存)
// ============================================================
export const scanResults = mysqlTable("scan_results", {
  id: int("id").autoincrement().primaryKey(),
  scanDate: varchar("scanDate", { length: 10 }).notNull(), // YYYY-MM-DD
  symbol: varchar("symbol", { length: 20 }).notNull(),
  strategy: varchar("strategy", { length: 50 }).notNull(),
  signalType: mysqlEnum("signalType", ["buy", "sell", "hold"]).default("hold").notNull(),
  score: int("score").default(0).notNull(),
  rsi: varchar("rsi", { length: 20 }),
  macdHistogram: varchar("macdHistogram", { length: 20 }),
  ladderGap: varchar("ladderGap", { length: 20 }),
  bbPosition: varchar("bbPosition", { length: 20 }),
  volumeRatio: varchar("volumeRatio", { length: 20 }),
  signals: text("signals"), // JSON array of signal strings
  trend: mysqlEnum("trend", ["up", "down", "neutral"]).default("neutral"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ScanResult = typeof scanResults.$inferSelect;
export type InsertScanResult = typeof scanResults.$inferInsert;

// ============================================================
// Data Source Priority (用户自定义数据源优先级)
// ============================================================
export const dataSourcePriority = mysqlTable("data_source_priority", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sourceOrder: json("sourceOrder").$type<string[]>().notNull(), // ["eodhd", "tiingo", "finnhub", ...]
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => [
  uniqueIndex("idx_user_id").on(table.userId),
  index("idx_created").on(table.createdAt),
]);

export type DataSourcePriority = typeof dataSourcePriority.$inferSelect;
export type InsertDataSourcePriority = typeof dataSourcePriority.$inferInsert;

// ============================================================
// Watchlist (自选股监控)
// ============================================================
export const watchlist = mysqlTable("watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }),
  alertThreshold: int("alertThreshold").default(80),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("watchlist_user_symbol").on(table.userId, table.symbol),
  index("idx_watchlist_user").on(table.userId),
]);
export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = typeof watchlist.$inferInsert;

// ============================================================
// Market Cap Cache (市值缓存 - 定期更新)
// ============================================================
export const marketCapCache = mysqlTable("market_cap_cache", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  marketCap: bigint("marketCap", { mode: "number" }), // in USD (亿美元)
  currency: varchar("currency", { length: 10 }).default("USD"),
  source: varchar("source", { length: 50 }).notNull(), // "finnhub", "alphavantage", etc.
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_symbol").on(table.symbol),
  index("idx_source").on(table.source),
  index("idx_last_updated").on(table.lastUpdated),
]);

export type MarketCapCache = typeof marketCapCache.$inferSelect;
export type InsertMarketCapCache = typeof marketCapCache.$inferInsert;

// ============================================================
// Market Cap Update Log (市值更新日志)
// ============================================================
export const marketCapUpdateLog = mysqlTable("market_cap_update_log", {
  id: int("id").autoincrement().primaryKey(),
  updateDate: varchar("updateDate", { length: 10 }).notNull(), // YYYY-MM-DD
  totalSymbols: int("totalSymbols").notNull(),
  successCount: int("successCount").notNull(),
  failureCount: int("failureCount").notNull(),
  source: varchar("source", { length: 50 }).notNull(), // "finnhub", "alphavantage"
  errorLog: text("errorLog"), // JSON array of failed symbols
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_update_date").on(table.updateDate),
  index("idx_source").on(table.source),
]);

export type MarketCapUpdateLog = typeof marketCapUpdateLog.$inferSelect;
export type InsertMarketCapUpdateLog = typeof marketCapUpdateLog.$inferInsert;
