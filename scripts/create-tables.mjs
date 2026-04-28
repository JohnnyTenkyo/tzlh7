import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const tables = [
  `CREATE TABLE IF NOT EXISTS \`scheduled_warming_tasks\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`name\` varchar(255) NOT NULL,
    \`description\` text,
    \`sectors\` json,
    \`marketCapTiers\` json,
    \`customSymbols\` json,
    \`cronExpression\` varchar(100) NOT NULL DEFAULT '0 2 * * *',
    \`isEnabled\` boolean DEFAULT true,
    \`lastExecutedAt\` timestamp NULL,
    \`nextExecutedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`warming_progress\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`taskId\` varchar(64) NOT NULL,
    \`symbol\` varchar(20) NOT NULL,
    \`status\` enum('pending','success','failed') NOT NULL DEFAULT 'pending',
    \`dataSource\` varchar(30),
    \`errorMessage\` text,
    \`duration\` int,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`completedAt\` timestamp NULL,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`warming_stats\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`taskId\` varchar(64) NOT NULL,
    \`userId\` int NOT NULL,
    \`totalSymbols\` int NOT NULL DEFAULT 0,
    \`successCount\` int NOT NULL DEFAULT 0,
    \`failCount\` int NOT NULL DEFAULT 0,
    \`startedAt\` timestamp NOT NULL DEFAULT (now()),
    \`completedAt\` timestamp NULL,
    \`status\` enum('running','completed','failed') NOT NULL DEFAULT 'running',
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`watchlist\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`symbol\` varchar(20) NOT NULL,
    \`name\` varchar(100),
    \`alertThreshold\` int DEFAULT 80,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`watchlist_user_symbol\` (\`userId\`, \`symbol\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`data_source_priority\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`source\` varchar(50) NOT NULL,
    \`priority\` int NOT NULL DEFAULT 5,
    \`isEnabled\` boolean DEFAULT true,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`system_task_log\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`taskName\` varchar(100) NOT NULL,
    \`executedAt\` timestamp NOT NULL DEFAULT (now()),
    \`success\` tinyint(1) NOT NULL DEFAULT 0,
    \`message\` text,
    \`stats\` json,
    PRIMARY KEY (\`id\`)
  )`,
];

for (const sql of tables) {
  try {
    await conn.execute(sql);
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS `([^`]+)`/)?.[1];
    console.log(`✓ Table ${tableName} created/verified`);
  } catch (e) {
    console.error(`✗ Error: ${e.message}`);
  }
}

await conn.end();
console.log('Done!');
// This will be run separately
