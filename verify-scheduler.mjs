#!/usr/bin/env node

/**
 * 验证脚本：测试定时任务是否能在指定时间触发
 * 这个脚本会监控定时任务的执行情况
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), '.manus-logs/devserver.log');

function readLogFile() {
  try {
    return fs.readFileSync(logFile, 'utf-8');
  } catch (err) {
    console.error('Failed to read log file:', err.message);
    return '';
  }
}

function checkSchedulerStatus() {
  const log = readLogFile();
  
  console.log('=== 定时任务状态检查 ===\n');
  
  // 检查调度器是否启动
  const schedulerStarted = log.includes('[CacheScheduler] Started');
  console.log(`✓ 调度器启动状态: ${schedulerStarted ? '已启动' : '未启动'}`);
  
  // 检查是否有每日扫描任务执行的日志
  const dailyScanExecuted = log.includes('[CacheScheduler] Running daily scan task');
  console.log(`✓ 每日扫描任务执行状态: ${dailyScanExecuted ? '已执行' : '未执行'}`);
  
  // 检查是否有每日缓存预热任务执行的日志
  const dailyCacheExecuted = log.includes('[CacheScheduler] Running daily cache warming task');
  console.log(`✓ 每日缓存预热任务执行状态: ${dailyCacheExecuted ? '已执行' : '未执行'}`);
  
  // 获取最后的调度器日志
  const lines = log.split('\n');
  const schedulerLines = lines.filter(line => line.includes('[CacheScheduler]'));
  
  console.log('\n=== 最近的调度器日志 ===');
  schedulerLines.slice(-10).forEach(line => {
    console.log(line);
  });
  
  console.log('\n=== 时间信息 ===');
  const now = new Date();
  console.log(`当前时间 (本地): ${now.toString()}`);
  console.log(`当前时间 (UTC): ${now.toUTCString()}`);
  console.log(`UTC 小时: ${now.getUTCHours()}`);
  console.log(`UTC 分钟: ${now.getUTCMinutes()}`);
  console.log(`每日扫描计划时间: UTC 13:00 (美东时间 09:00 AM)`);
  console.log(`每日缓存预热计划时间: UTC 12:00 (美东时间 08:00 AM)`);
  
  console.log('\n=== 诊断信息 ===');
  if (schedulerStarted && !dailyScanExecuted) {
    console.log('⚠️  调度器已启动但每日扫描任务未执行。可能原因：');
    console.log('  1. 当前时间不在计划执行时间内');
    console.log('  2. 上次执行时间记录有问题');
    console.log('  3. 任务执行失败但未记录');
  } else if (dailyScanExecuted) {
    console.log('✓ 每日扫描任务已成功执行');
  }
}

checkSchedulerStatus();
