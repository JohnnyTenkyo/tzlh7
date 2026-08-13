# tzlh7 腾讯云迁移待办

- [x] 审查 GitHub 源码、构建方式与环境变量需求（Node.js 全栈应用，含 MariaDB、WebSocket 与常驻定时任务；本地生产构建通过）
- [x] 获取或迁移生产所需的行情与 AI 服务环境变量（已接入 Alpaca、Alpha Vantage、Tiingo、EODHD 与 Finnhub；Gemini/OpenAI 密钥未提供，AI 分析功能暂保持未配置）
- [x] 核查 Manus 原站数据库是否仍可访问，并确定历史行情、回测和扫描数据的迁移价值（该库为 Manus 托管资源；按用户选择不迁移历史数据，改为创建独立空库）
- [x] 将用户提供的 Alpaca、Alpha Vantage、Tiingo、EODHD 与 Finnhub 密钥安全写入 PM2 生产环境，不提交至仓库
- [x] 建立独立的服务器应用目录、运行端口和 PM2 进程
- [x] 配置独立 Nginx 虚拟主机，确保不影响既有网站
- [x] 在 Cloudflare 建立 tzlh.cc.cd 区域、DNS 记录和 Full (strict) HTTPS
- [x] 构建并启动生产应用
- [x] 验证 tzlh.cc.cd 的 HTTPS、核心页面及服务状态（HTTP 301、HTTPS 200、正式注册会话与后台任务均已验证）
- [x] 编写站点专属运维记录并保存迁移检查点
- [ ] 将本次临时访问凭据保留至全部站点迁移完成后统一撤销
