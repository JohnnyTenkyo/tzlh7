# TZLH量化交易平台 TODO

## 代码迁移
- [x] 迁移 drizzle/schema.ts（添加所有业务表）
- [x] 迁移 server/marketData.ts
- [x] 迁移 server/indicators.ts
- [x] 迁移 server/backtestEngine.ts
- [x] 迁移 server/signalScanner.ts
- [x] 迁移 server/cacheManager.ts
- [x] 迁移 server/cacheScheduler.ts
- [x] 迁移 server/routers.ts（含所有子路由）
- [x] 迁移 server/routers/scanHistory.ts
- [x] 迁移 server/routers/dataSourcePriority.ts
- [x] 迁移 shared/stockPool.ts
- [x] 迁移前端 DashboardLayout 组件
- [x] 迁移前端 ScanHistoryViewer 组件
- [x] 迁移前端所有页面（Home、BacktestPage、BacktestDetailPage、TodayScanPage、StockPoolPage、CachePage、HealthPage、SettingsPage、ChartPage）
- [x] 配置简易用户名密码登录（禁止 OAuth）

## 功能修复
- [x] 修复1：回测历史记录下载Excel按钮事件冒泡问题（改为独立跟踪每行下载状态）
- [x] 修复2：Excel导出缺少策略参数（止盈止损、移动止损、最大持仓天数等中文标签）
- [x] 修复3：收益曲线中SPY/QQQ显示为直线，改为从resultSummary读取真实历史K线数据
- [x] 修复4：历史记录对比收益率曲线显示为直线，改为从resultSummary读取真实equityCurve
- [x] 修复5：首页标题旁显示北京时间和美东时间（每秒刷新的DualClock组件）
- [x] 修复6：数据源健康页面增加"一键全部测试"批量重测按钮（测试完成后自动刷新）
- [x] 修复7：自选股监控功能（股票池收藏、首页实时股价、扫描高亮、阈值提醒）
- [x] 修复8：隐藏侧边栏K线图表入口

## 环境配置
- [x] 安装依赖：bcryptjs、xlsx、socket.io、socket.io-client
- [x] 配置 API Keys：Alpaca、Alphavantage、Tiingo、EODHD、Finnhub
- [x] 执行数据库迁移（创建所有业务表）

## 验证与部署
- [x] 缓存15只核心股票K线数据（约2511根/只，从2016年至今）
- [x] 执行今日全量扫描（发现60个信号）
- [x] 单元测试全部通过（11个测试）
- [x] 保存 checkpoint
- [ ] 用户点击 Publish 按钮发布到 manus.space
