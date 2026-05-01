import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  BarChart2, TrendingUp, Database, Activity, ArrowRight, Cpu,
  Scan, Star, TrendingDown, Minus, RefreshCw, ChevronRight, Clock
} from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";

function DualClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const beijing = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const eastern = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const etLabel = (() => {
    // Determine if EDT or EST
    const jan = new Date(now.getFullYear(), 0, 1);
    const jul = new Date(now.getFullYear(), 6, 1);
    const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    const isDST = now.getTimezoneOffset() < stdOffset;
    return isDST ? 'EDT' : 'EST';
  })();
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      <span className="flex items-center gap-1">
        <span className="text-foreground/60">北京</span>
        <span className="text-foreground font-medium">{beijing}</span>
      </span>
      <span className="text-border">|</span>
      <span className="flex items-center gap-1">
        <span className="text-foreground/60">{etLabel}</span>
        <span className="text-foreground font-medium">{eastern}</span>
      </span>
    </div>
  );
}

const STRATEGY_LABELS: Record<string, string> = {
  standard: "标准策略",
  aggressive: "激进策略",
  ladder_cd_combo: "组合策略",
  mean_reversion: "均值回归",
  macd_volume: "MACD量价",
  bollinger_squeeze: "布林收缩",
  vamr: "VAMR",
  rsi_reversal: "RSI反转",
};

const STRATEGY_COLORS: Record<string, string> = {
  standard: "text-blue-400",
  aggressive: "text-red-400",
  ladder_cd_combo: "text-purple-400",
  mean_reversion: "text-green-400",
  macd_volume: "text-yellow-400",
  bollinger_squeeze: "text-cyan-400",
  vamr: "text-orange-400",
  rsi_reversal: "text-pink-400",
};

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp className="w-3 h-3 text-green-400" />;
  if (trend === "down") return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400";
  return <span className={`text-lg font-bold font-mono ${color}`}>{score}</span>;
}

function TopSignalCard({ strategy, signals, onViewAll }: {
  strategy: string;
  signals: any[];
  onViewAll: () => void;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className={`text-sm font-semibold ${STRATEGY_COLORS[strategy] || "text-foreground"}`}>
          {STRATEGY_LABELS[strategy] || strategy}
        </CardTitle>
        <button onClick={onViewAll} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
          查看全部 <ChevronRight className="w-3 h-3" />
        </button>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {signals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">暂无数据，请先运行扫描</p>
        ) : (
          signals.slice(0, 10).map((s: any, i: number) => (
            <div key={`${s.symbol}-${i}`} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4 text-right">{i + 1}</span>
                <span className="font-mono font-bold text-sm text-primary">{s.symbol}</span>
                <span className="text-xs text-muted-foreground hidden sm:block">{s.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendIcon trend={s.trend} />
                <ScoreRing score={s.score} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const { data: cacheData } = trpc.cache.status.useQuery(undefined, { retry: false });
  const { data: failedData } = trpc.cache.failedSymbols.useQuery(undefined, { retry: false });
  const { data: healthData } = trpc.health.sources.useQuery(undefined, { retry: false });
  const { data: geminiStatus } = trpc.health.geminiStatus.useQuery(undefined, { retry: false });
  const { data: scanSummary } = trpc.scan.todaySummary.useQuery(undefined, { retry: false, refetchInterval: 120000 });
  const { data: lastRunTimes } = trpc.scan.lastRunTimes.useQuery(undefined, { retry: false, refetchInterval: 300000 });
  const { data: watchlistPrices } = trpc.watchlist.prices.useQuery(undefined, { enabled: isAuthenticated, retry: false, refetchInterval: 60000 });

  // Fetch top signals for each strategy
  const strategies = ["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"];
  const topSignalQueries = strategies.map(strategy =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    trpc.scan.topSignals.useQuery({ strategy: strategy as any, limit: 10 }, { retry: false, refetchInterval: 120000 })
  );

  const totalCached = (Array.isArray(cacheData?.cacheEntries) ? cacheData.cacheEntries.length : 0) || 0;
  const stockPoolTotal = failedData?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">量化回测平台</h1>
            <DualClock />
          </div>
          <p className="text-muted-foreground mt-1">多数据源聚合 · 8种策略回测 · Gemini AI 智能分析</p>
        </div>
        {!isAuthenticated ? (
          <Button onClick={() => setLocation("/auth")} className="gap-2">
            登录 / 注册 <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <div className="text-sm text-muted-foreground">
            欢迎，<span className="text-foreground font-medium">{user?.name || user?.email}</span>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-blue-400">{stockPoolTotal}</div>
            <div className="text-xs text-muted-foreground mt-1">股票池总量</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-green-400">8</div>
            <div className="text-xs text-muted-foreground mt-1">回测策略数</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-yellow-400">{totalCached}</div>
            <div className="text-xs text-muted-foreground mt-1">已缓存数据集</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className={`text-2xl font-bold ${geminiStatus?.connected ? "text-cyan-400" : "text-muted-foreground"}`}>
              {geminiStatus?.connected ? "在线" : "检测中"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">AI 服务状态</div>
          </CardContent>
        </Card>
      </div>

      {/* Watchlist Prices */}
      {isAuthenticated && watchlistPrices && watchlistPrices.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
              自选股实时行情
              <span className="text-xs text-muted-foreground font-normal ml-1">每分钟更新</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex flex-wrap gap-3">
              {watchlistPrices.map((item: any) => (
                <div
                  key={item.symbol}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors ${
                    item.price > 0 && item.alertThreshold > 0 ? 'border-border' : 'border-border'
                  }`}
                  onClick={() => setLocation(`/chart?symbol=${item.symbol}`)}
                >
                  <div>
                    <div className="font-mono font-bold text-sm text-primary">{item.symbol}</div>
                    {item.name && item.name !== item.symbol && (
                      <div className="text-xs text-muted-foreground truncate max-w-[80px]">{item.name}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-medium text-sm">
                      {item.price > 0 ? `$${item.price.toFixed(2)}` : '-'}
                    </div>
                    <div className={`text-xs font-mono ${
                      item.change > 0 ? 'text-green-400' : item.change < 0 ? 'text-red-400' : 'text-muted-foreground'
                    }`}>
                      {item.change > 0 ? '+' : ''}{item.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Run Times Banner */}
      {(lastRunTimes?.lastScanTime || lastRunTimes?.lastCacheTime) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 rounded-lg border border-border bg-muted/30 text-xs">
          <span className="text-muted-foreground font-medium shrink-0">最近自动任务：</span>
          {lastRunTimes?.lastScanTime && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              <span className="text-muted-foreground">全量扫描：</span>
              <span className="text-blue-400 font-mono">
                {new Date(lastRunTimes.lastScanTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </span>
          )}
          {lastRunTimes?.lastCacheTime && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
              <span className="text-muted-foreground">K线缓存：</span>
              <span className="text-purple-400 font-mono">
                {new Date(lastRunTimes.lastCacheTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </span>
          )}
          <span className="text-muted-foreground/50 ml-auto">每日自动更新</span>
        </div>
      )}
      {/* Today Scan CTA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30 hover:border-primary/60 transition-colors cursor-pointer group"
          onClick={() => setLocation("/scan")}>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/20">
                  <Scan className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="font-bold text-base">今日全量扫描{scanSummary?.isYesterdayData && <span className="text-xs text-yellow-400 ml-2">(显示前一日数据)</span>}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {scanSummary?.totalBuy ? `买入信号 ${scanSummary.totalBuy} 个` : "实时扫描全部股票"}
                  </div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border-yellow-500/30 hover:border-yellow-500/60 transition-colors cursor-pointer group"
          onClick={() => setLocation("/scan")}>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-yellow-500/20">
                  <Star className="h-6 w-6 text-yellow-400" />
                </div>
                <div>
                  <div className="font-bold text-base">今日高分推荐{scanSummary?.isYesterdayData && <span className="text-xs text-yellow-400 ml-2">(显示前一日数据)</span>}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {scanSummary?.totalBuy ? `${strategies.length} 种策略 · 各策略 TOP 10` : "多策略高分买入信号排行榜"}
                  </div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-yellow-400 group-hover:translate-x-1 transition-all" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today Top Signals - Rankings */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400" />
            今日高分股票推荐
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/scan")} className="text-xs gap-1">
            查看全量扫描 <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {strategies.map((strategy, i) => (
            <TopSignalCard
              key={strategy}
              strategy={strategy}
              signals={topSignalQueries[i]?.data || []}
              onViewAll={() => setLocation("/scan")}
            />
          ))}
        </div>
      </div>

      {/* Bottom Status Bar - Data Sources + AI Services */}
      <div className="border border-border rounded-lg bg-card/50 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-muted-foreground font-medium shrink-0">数据源 & AI 状态：</span>
          {["Alpaca", "Stooq", "Yahoo", "Tiingo", "Finnhub", "AlphaVantage", "Polygon", "TwelveData", "MarketStack"].map(source => {
            const health = healthData?.find(h => h.source.toLowerCase() === source.toLowerCase());
            const isHealthy = health && (health.successCount || 0) > 0;
            const hasFailed = health && (health.failCount || 0) > 0;
            return (
              <span key={source} className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
                isHealthy ? "bg-green-500/10 text-green-400 border-green-500/30"
                : hasFailed ? "bg-red-500/10 text-red-400 border-red-500/30"
                : "bg-muted text-muted-foreground border-border"
              }`}>{source}</span>
            );
          })}
          <span className="text-muted-foreground">|</span>
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
            geminiStatus?.gemini?.connected ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" : "bg-muted text-muted-foreground border-border"
          }`}>Gemini {geminiStatus?.gemini?.connected ? "✓" : "—"}</span>
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
            geminiStatus?.openai?.connected ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" : "bg-muted text-muted-foreground border-border"
          }`}>OpenAI {geminiStatus?.openai?.connected ? "✓" : "—"}</span>
          <span className="text-muted-foreground ml-auto">当前AI: {geminiStatus?.activeProvider === "gemini" ? "Gemini" : geminiStatus?.activeProvider === "openai" ? "OpenAI" : "检测中"}</span>
        </div>
      </div>
    </div>
  );
}
