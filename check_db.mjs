import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'quant.db');

const db = new Database(dbPath);

// 检查股票池中的活跃股票数
const activeStocks = db.prepare(`
  SELECT COUNT(*) as count FROM symbols 
  WHERE is_excluded = 0
`).get();

console.log('活跃股票总数:', activeStocks.count);

// 检查被排除的股票数
const excludedStocks = db.prepare(`
  SELECT COUNT(*) as count FROM symbols 
  WHERE is_excluded = 1
`).get();

console.log('被排除股票数:', excludedStocks.count);

// 检查总股票数
const totalStocks = db.prepare(`
  SELECT COUNT(*) as count FROM symbols
`).get();

console.log('总股票数:', totalStocks.count);

// 检查缓存的股票数
const cachedStocks = db.prepare(`
  SELECT COUNT(*) as count FROM kline_cache 
  WHERE symbol IN (SELECT symbol FROM symbols WHERE is_excluded = 0)
`).get();

console.log('已缓存的活跃股票数:', cachedStocks.count);

db.close();
