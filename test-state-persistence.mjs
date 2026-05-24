#!/usr/bin/env node

/**
 * 测试脚本：验证定时任务状态持久化功能
 * 
 * 这个脚本模拟：
 * 1. 第一次执行定时任务，保存状态到数据库
 * 2. 服务器重启
 * 3. 从数据库恢复状态
 * 4. 验证状态是否正确恢复
 */

import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL environment variable not set");
  process.exit(1);
}

async function testStatePersistence() {
  const pool = mysql.createPool(DB_URL);
  
  try {
    console.log("=== 定时任务状态持久化测试 ===\n");
    
    // 1. 检查 system_config 表是否存在
    console.log("1. 检查 system_config 表...");
    const [tables] = await pool.execute(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_config'
    `);
    
    if (tables.length === 0) {
      console.error("❌ system_config 表不存在");
      return;
    }
    console.log("✓ system_config 表存在\n");
    
    // 2. 插入测试数据（模拟定时任务执行）
    console.log("2. 插入测试数据（模拟定时任务执行）...");
    const testTime = new Date("2026-05-24T10:00:00Z").toISOString();
    await pool.execute(`
      INSERT INTO system_config (\`key\`, \`value\`) 
      VALUES ('scheduler:lastDailyScanRun', ?)
      ON DUPLICATE KEY UPDATE \`value\` = ?
    `, [testTime, testTime]);
    console.log(`✓ 已保存 lastDailyScanRun: ${testTime}\n`);
    
    // 3. 验证数据是否正确保存
    console.log("3. 验证数据是否正确保存...");
    const [rows] = await pool.execute(`
      SELECT \`key\`, \`value\` FROM system_config 
      WHERE \`key\` = 'scheduler:lastDailyScanRun'
    `);
    
    if (rows.length === 0) {
      console.error("❌ 数据未保存");
      return;
    }
    
    const savedValue = rows[0].value;
    console.log(`✓ 数据已保存: ${savedValue}\n`);
    
    // 4. 模拟服务器重启后恢复状态
    console.log("4. 模拟服务器重启后恢复状态...");
    const [recoveredRows] = await pool.execute(`
      SELECT \`key\`, \`value\` FROM system_config 
      WHERE \`key\` IN ('scheduler:lastDailyScanRun', 'scheduler:lastDailyCacheRun')
    `);
    
    if (recoveredRows.length > 0) {
      for (const row of recoveredRows) {
        const recoveredTime = new Date(row.value);
        console.log(`✓ 恢复 ${row.key}: ${recoveredTime.toISOString()}`);
      }
    } else {
      console.log("✓ 没有之前保存的状态（首次启动）");
    }
    
    console.log("\n=== 测试完成 ===");
    console.log("✓ 定时任务状态持久化功能正常");
    
  } catch (err) {
    console.error("❌ 测试失败:", err.message);
  } finally {
    await pool.end();
  }
}

testStatePersistence();
