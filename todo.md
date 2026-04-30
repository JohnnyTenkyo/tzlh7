# TZLH Quant v7 项目 TODO

## 已完成功能
- [x] 基础框架搭建（React + Express + tRPC + Drizzle）
- [x] 用户认证系统（Manus OAuth）
- [x] 股票池管理（778 只股票）
- [x] 回测引擎（支持 11 种策略）
- [x] K 线数据缓存系统
- [x] 回测报告导出（Excel）
- [x] 市值数据系统（Finnhub + AlphaVantage API）
- [x] Excel 参数中文显示修复
- [x] 定期市值更新任务内置（每天美东时间 8 点）

## 当前会话修复（v7 继续）
- [x] 修复 db.ts 缺失函数
- [x] 修复股票池市值显示（显示"未知"）
- [x] 修复 Excel 导出参数乱码：策略参数显示为中文标签
- [x] 修复前端对比模式参数转换
- [x] 创建市值数据库迁移脚本
- [x] 实施 Finnhub API 批量获取市值
- [x] 实施 AlphaVantage API 备用方案
- [x] 创建后台定期更新任务
- [x] 内置 node-cron 定时任务（每天美东时间 8 点）

## 部署前必需步骤
- [ ] 发布到 manus.space：点击 Publish 按钮部署最新版本
- [ ] 执行数据库迁移（部署后）：运行 scripts/apply-market-cap-migration.sql 创建市值表

## 可选优化项
- [ ] 验证 Finnhub API 连接
- [ ] 验证 AlphaVantage API 连接
- [ ] 监控定期任务执行日志

## 测试覆盖
- 总计 74 个单元测试全部通过
  - 6 个 Excel 导出测试
  - 22 个市值更新测试
  - 15 个定时任务集成测试
  - 10 个定时器测试
  - 17 个其他功能测试
  - 1 个认证测试
