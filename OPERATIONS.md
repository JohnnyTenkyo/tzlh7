# TZLH 量化交易平台生产运维记录

**正式地址：** `https://tzlh.cc.cd`  
**服务器：** 腾讯云 `43.130.0.81`  
**应用目录：** `/var/www/tzlh7`  
**进程：** PM2 `tzlh7`（单实例 fork 模式，端口 `3004`）  
**数据库：** 本机 MariaDB 数据库 `tzlh7`

## 架构与安全边界

应用由 Nginx 反向代理至本机 `127.0.0.1:3004`。Nginx 配置位于 `/etc/nginx/conf.d/tzlh.conf`，Cloudflare Origin CA 证书与私钥位于 `/etc/nginx/ssl/tzlh.cc.cd.pem` 和 `/etc/nginx/ssl/tzlh.cc.cd.key`。Cloudflare 使用代理 DNS、严格源站 TLS 校验和 HTTP 自动跳转 HTTPS。

量化平台使用单实例运行。这是因为应用含有 WebSocket、缓存轮询和每日市值更新任务；多实例会使同一调度逻辑重复执行，造成重复 API 消耗或重复写入。

| 项目 | 当前状态 | 说明 |
|---|---|---|
| HTTP 到 HTTPS | 已启用 | `http://tzlh.cc.cd` 返回 301 至 HTTPS。 |
| Cloudflare TLS | 已启用 | SSL 模式为 strict，Cloudflare 会验证 Nginx Origin CA 证书。 |
| 应用会话 | 已验证 | 正式域名的注册、Cookie 会话读取和临时账户清理均已测试。 |
| 行情数据源 | 已接入 | Alpaca、Alpha Vantage、Tiingo、EODHD 与 Finnhub 的生产密钥已写入 PM2 运行环境。 |
| AI 分析 | 未配置 | 尚未提供 Gemini 或 OpenAI 密钥；依赖 AI 的分析功能需提供密钥后再启用。 |
| 历史 Manus 数据 | 未迁移 | 原数据库为 Manus 托管资源；按当前决定以独立空库上线。 |

> 服务器上的 API 密钥与数据库连接配置仅保存在 PM2 的进程环境中。不要把密钥、数据库导出文件、Origin CA 私钥或临时 SSH 私钥提交到 Git 仓库。

## 日常操作

执行以下命令前先进入应用目录，并确保 Node.js 22 在路径中：

```bash
export PATH=/usr/local/node22/bin:$PATH
cd /var/www/tzlh7
```

| 目的 | 命令 |
|---|---|
| 查看应用状态 | `pm2 status tzlh7` |
| 查看应用日志 | `pm2 logs tzlh7 --lines 200` |
| 重启应用（保留当前进程环境） | `pm2 restart tzlh7` |
| 查看 Nginx 配置有效性 | `nginx -t` |
| 平滑重载 Nginx | `systemctl reload nginx` |
| 查看 MariaDB 状态 | `systemctl status mariadb --no-pager` |

如仅更新代码，在确认 GitHub `main` 已验证后运行：

```bash
export PATH=/usr/local/node22/bin:$PATH
cd /var/www/tzlh7
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pm2 restart tzlh7
```

当前机密配置由 PM2 托管。更新部署时不要使用空环境执行 `pm2 start ecosystem.config.cjs --update-env`，否则可能覆盖现有密钥。需要变更密钥时，应在受控操作中一次性提供完整环境变量后再重启进程。

## 备份与恢复

建议每天创建 MariaDB 逻辑备份，并将加密副本同步到受控的异地存储：

```bash
mkdir -p /root/backups/tzlh7
mariadb-dump --single-transaction --routines --events tzlh7 \
  > /root/backups/tzlh7/tzlh7-$(date +%F-%H%M%S).sql
```

恢复前先创建当前库的备份并停止写入；确认目标数据允许覆盖后执行：

```bash
mariadb tzlh7 < /root/backups/tzlh7/目标备份文件.sql
pm2 restart tzlh7
```

若仍需保留原 Manus 网站中的用户、回测、成交、K 线缓存、扫描结果和自选股，需先在原项目仍可访问时导出任务数据备份。若数据库已经被删除且无任务数据备份，原数据无法从代码或第三方行情 API 中恢复。

## 本次验证记录

生产构建成功。服务端完整测试结果为 **133 项通过、9 项跳过**；Finnhub 与 Alpha Vantage 的实测调用均成功。正式域名首页返回 HTTPS 200，源站本机健康检查返回 200，PM2 进程处于 online 状态，缓存调度器已启动。

### 扫描任务迁移修复

2026-08-13 已补充 `scan_jobs` 的正式 Drizzle 迁移。该表保存全量扫描的启动、进度、完成、失败与取消状态；缺失时会导致“立即扫描”在插入任务记录阶段失败。生产库已成功应用迁移，并以一次性空筛选扫描任务完成正式域名端到端验证，临时用户和任务记录已清理。

## 临时访问收尾

本次临时 SSH 私钥会保留至用户确认所有待迁移站点均已完成。届时应从服务器 `authorized_keys` 移除对应公钥，并从部署环境删除私钥文件，再重置服务器管理员密码或改用独立的最小权限运维账户。
