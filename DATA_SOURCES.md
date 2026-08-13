# TZLH 生产数据源核验与免费来源评估

本记录基于 2026-08-13 的生产环境核验。服务器进程已加载 Alpaca、Alpha Vantage、Tiingo、EODHD 与 Finnhub 的密钥，但“已加载密钥”不等于该来源已适合全量扫描。系统会对约 793 只股票依序读取 K 线，因此日配额和历史数据授权比单次 API 测试更关键。

## 生产实测状态

| 来源 | 密钥环境 | 当前代码中的用途 | 实测结果 | 结论 |
|---|---|---|---|---|
| EODHD | 已加载 | 日线优先来源 | AAPL 请求返回 HTTP 402 | 当前账户不能用于生产扫描；需确认套餐或更换可用密钥。 |
| Tiingo | 已加载 | 日线回退 | 返回日配额已耗尽 | 当前不可作为即时扫描依赖。 |
| Finnhub | 已加载 | 日线回退、市值查询 | 免费层历史 K 线请求被拒；市值测试此前成功 | 可保留用于市值/基本面，但不应依赖其免费层拉取历史 K 线。 |
| Alpha Vantage | 已加载 | 日线回退 | 未返回 AAPL 近 30 日 K 线 | 配额过小，不能支撑全量扫描。 |
| Alpaca | 已加载 | 当前未进入 K 线获取链 | 健康测试返回 `Unknown source` | 密钥已部署，但现有适配器尚未实现 Alpaca K 线抓取。 |
| Yahoo Finance | 无需密钥 | 日线、小时、15 分钟末级回退 | AAPL 返回 2513 根 K 线 | 当前可用，但属于非正式公开端点，应仅作为回退而非唯一生产来源。 |
| Twelve Data | 已加载 | 日线、小时、15 分钟回退 | 正式域名 AAPL 日线测试成功返回 22 根 K 线 | 已可用；免费层必须实施节流后再用于批量任务。 |

> 当前故障不是数据库问题。扫描的数据库任务表已修复；后续全量扫描的稳定性主要取决于能否取得足够、合规且未被限流的行情数据。

## 可补充的免费来源

| 选择 | 代码支持 | 官方免费额度与边界 | 对本项目的建议 |
|---|---|---|---|
| Twelve Data | 已实现，需 `TWELVE_DATA_API_KEY` | Basic 免费层为每分钟 8 API credits、每天 800 credits；按每个股票 1 credit 计 [4] | 最适合补充日线/15 分钟/小时级回退。但按当前逐股票请求方式，一次近 793 股票的全量扫描就接近每日额度；宜用于精选股票或低频缓存。 |
| Marketstack | 已实现，需 `MARKETSTACK_API_KEY` | 官方免费层用于入门，公开资料说明免费额度有限 [5] | 仅适合作为小规模 EOD 兜底，无法承担全量扫描。 |
| Yahoo Finance | 已实现，无需密钥 | 未提供面向此类自动化抓取的正式开发者 API 合同 | 维持末级回退；须控制并发、缓存结果，避免把它作为商业或高频主源。 |
| Stooq | 已实现但当前代码检测到其端点要求 API key | 可下载历史市场数据，但当前在线端点会要求 key [6] | 不建议在未获得授权凭据和确认使用条款前作为生产依赖。 |

## 已部署提供商的配额含义

Alpha Vantage 官方免费层为每天 25 次请求 [1]；EODHD 免费层为每天 20 次请求 [3]；Finnhub 免费层页面列明 60 次请求/分钟，但不同数据集的授权范围不同 [2]。这些免费额度适合测试、少量标的和市值/基本面补充，并不适合不加缓存地对数百个股票重复拉取历史 K 线。

## 推荐的下一步

建议先不再盲目新增密钥，而是将当前策略改为“本地缓存优先、只增量更新过期标的、低频扫描”。Twelve Data 已接入并适合精选清单或小时/15 分钟回退；若用于更大批量，必须先增加每分钟 8 credits 的节流控制。若要稳定运行约 793 只股票的每日全量扫描，建议后续实现 Alpaca K 线适配器，或选定一个具备足够日线授权的单一主数据源。

## 参考资料

[1]: https://www.alphavantage.co/support/ "Alpha Vantage Support"
[2]: https://finnhub.io/pricing "Finnhub Pricing"
[3]: https://eodhd.com/pricing "EODHD Pricing"
[4]: https://twelvedata.com/pricing "Twelve Data Individual Pricing"
[5]: https://marketstack.com/pricing "Marketstack Pricing"
[6]: https://stooq.com/db/ "Stooq Free Market Data"
