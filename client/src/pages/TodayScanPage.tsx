import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Scan, TrendingUp, TrendingDown, Minus, RefreshCw, Filter, Search,
  ArrowUpDown, BarChart2, ChevronLeft, ChevronRight, LayoutGrid, Columns, History
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { SECTOR_LABELS, MARKET_CAP_TIER_LABELS } from "@shared/stockPool";
import type { StockSector, MarketCapTier } from "@shared/stockPool";
import { useAuth } from "@/_core/hooks/useAuth";
import { ScanHistoryViewer } from "@/components/ScanHistoryViewer";

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

const ALL_STRATEGIES = Object.keys(STRATEGY_LABELS);
const ALL_SECTORS = Object.keys(SECTOR_LABELS) as StockSector[];
const ALL_TIERS = Object.keys(MARKET_CAP_TIER_LABELS) as MarketCapTier[];

function SignalBadge({ signal }: { signal: string }) {
  if (signal === "buy") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">买入</Badge>;
  if (signal === "sell") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">卖出</Badge>;
  return <Badge variant="secondary">持有</Badge>;
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp className="w-3 h-3 text-green-400" />;
  if (trend === "down") return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-6 text-right">{score}</span>
    </div>
  );
}

export default function TodayScanPage() {
  const { isAuthenticated } = useAuth();
  const [viewMode, setViewMode] = useState<"table" | "compare" | "history">("table");
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(["standard", "aggressive", "ladder_cd_combo", "mean_reversion", "macd_volume", "bollinger_squeeze", "vamr", "rsi_reversal"]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);
  const [signalTypeFilter, setSignalTypeFilter] = useState<"buy" | "sell" | "hold" | "all">("buy");
  const [minScore, setMinScore] = useState(30);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"score" | "symbol" | "rsi">("score");
  const [scanning, setScanning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const { data: scanData, refetch, isLoading } = trpc.scan.getResults.useQuery({
    strategies: selectedStrategies as any,
    sectors: selectedSectors.length > 0 ? selectedSectors : undefined,
    marketCapTiers: selectedTiers.length > 0 ? selectedTiers : undefined,
    signalType: signalTypeFilter,
    minScore,
    limit: 50,
    page,
  }, { refetchInterval: 60000 });

  const { data: summary } = trpc.scan.todaySummary.useQuery(undefined, { refetchInterval: 60000 });
  const { data: watchlistData } = trpc.watchlist.list.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const watchlistMap = useMemo(() => {
    const map = new Map<string, number>();
    (watchlistData || []).forEach((w: any) => map.set(w.symbol, w.alertThreshold ?? 80));
    return map;
  }, [watchlistData]);

  // Poll job progress when activeJobId is set
  const { data: jobProgress } = trpc.scan.getScanJobProgress.useQuery(
    { jobId: activeJobId! },
    {
      enabled: activeJobId !== null,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data || data.status === 'done' || data.status === 'error') return false;
        return 2000;
      }
    }
  );
  // Auto-refresh results when job completes
  useEffect(() => {
    if (jobProgress?.status === 'done') {
      toast.success(`扫描完成！共发现 ${jobProgress.resultCount} 个信号`);
      setScanning(false);
      refetch();
    } else if (jobProgress?.status === 'error') {
      toast.error('扫描失败：' + (jobProgress.message || '未知错误'));
      setScanning(false);
    }
  }, [jobProgress?.status]);
  // Restore in-progress job on page load
  const { data: latestJob } = trpc.scan.getLatestScanJob.useQuery(undefined, { enabled: !!isAuthenticated });
  useEffect(() => {
    if (latestJob && latestJob.status === 'running' && !activeJobId) {
      setActiveJobId(latestJob.id);
      setScanning(true);
    }
  }, [latestJob?.id, latestJob?.status]);
  const startScan = trpc.scan.startScan.useMutation({
    onSuccess: (data) => {
      toast.success("扫描已启动，可离开页面，结果将自动保存");
      if (data.jobId) setActiveJobId(data.jobId);
    },
    onError: (e) => { toast.error(e.message); setScanning(false); },
  });

  const handleStartScan = () => {
    if (!isAuthenticated) { toast.error("请先登录"); return; }
    setScanning(true);
    startScan.mutate({
      strategies: selectedStrategies as any,
      sectors: selectedSectors.length > 0 ? selectedSectors : undefined,
      marketCapTiers: selectedTiers.length > 0 ? selectedTiers : undefined,
      minScore,
      signalType: signalTypeFilter !== "all" ? signalTypeFilter : undefined,
    });
  };

  const results = scanData?.results || [];
  const filteredResults = useMemo(() => {
    let r = results;
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      r = r.filter((s: any) => s.symbol.includes(q) || s.name?.includes(searchQuery));
    }
    if (sortBy === "symbol") r = [...r].sort((a: any, b: any) => a.symbol.localeCompare(b.symbol));
    else if (sortBy === "rsi") r = [...r].sort((a: any, b: any) => a.rsi - b.rsi);
    return r;
  }, [results, searchQuery, sortBy]);

  const toggleStrategy = (s: string) => {
    setSelectedStrategies(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    setPage(1);
  };
  const toggleSector = (s: string) => {
    setSelectedSectors(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    setPage(1);
  };
  const toggleTier = (s: string) => {
    setSelectedTiers(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    setPage(1);
  };

  // Compare view: group by symbol, show all strategies side by side
  const compareData = useMemo(() => {
    const bySymbol: Record<string, Record<string, any>> = {};
    for (const r of filteredResults) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { symbol: r.symbol, name: r.name, sectors: r.sectors, marketCap: r.marketCap };
      bySymbol[r.symbol][r.strategy] = r;
    }
    return Object.values(bySymbol).sort((a: any, b: any) => {
      const aMax = Math.max(...selectedStrategies.map(s => a[s]?.score || 0));
      const bMax = Math.max(...selectedStrategies.map(s => b[s]?.score || 0));
      return bMax - aMax;
    });
  }, [filteredResults, selectedStrategies]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scan className="w-6 h-6 text-primary" />
            今日信号全量扫描
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {summary?.date ? `${summary.date} · ` : ""}
            {summary ? `买入信号 ${summary.totalBuy} 个 · 卖出信号 ${summary.totalSell} 个` : "实时扫描全部股票，多策略信号分析"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setViewMode("table")} className={viewMode === "table" ? "bg-primary text-primary-foreground" : ""}>
            <LayoutGrid className="w-4 h-4 mr-1" />列表
          </Button>
          <Button variant="outline" size="sm" onClick={() => setViewMode("compare")} className={viewMode === "compare" ? "bg-primary text-primary-foreground" : ""}>
            <Columns className="w-4 h-4 mr-1" />对比
          </Button>
          <Button variant="outline" size="sm" onClick={() => setViewMode("history")} className={viewMode === "history" ? "bg-primary text-primary-foreground" : ""}>
            <History className="w-4 h-4 mr-1" />历史
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button size="sm" onClick={handleStartScan} disabled={scanning || !isAuthenticated}>
            <Scan className={`w-4 h-4 mr-1 ${scanning ? "animate-pulse" : ""}`} />
            {scanning ? "后台扫描中..." : "立即扫描"}
          </Button>
        </div>
      </div>

      {/* Scan Progress Bar */}
      {scanning && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-primary flex items-center gap-2">
                <Scan className="w-4 h-4 animate-pulse" />
                {jobProgress?.message || '扫描启动中...'}
              </span>
              <span className="text-muted-foreground font-mono">{jobProgress?.percent ?? 0}%</span>
            </div>
            <Progress value={jobProgress?.percent ?? 0} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>当前：{jobProgress?.currentSymbol || '—'}</span>
              <span className="text-green-500/80">✓ 可离开此页面，扫描将在后台继续运行</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">策略：</span>
            {ALL_STRATEGIES.map(s => (
              <button key={s} onClick={() => toggleStrategy(s)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${selectedStrategies.includes(s) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                {STRATEGY_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium ml-5">行业：</span>
            {ALL_SECTORS.slice(0, 12).map(s => (
              <button key={s} onClick={() => toggleSector(s)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${selectedSectors.includes(s) ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "border-border text-muted-foreground hover:border-blue-500/30"}`}>
                {SECTOR_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium ml-5">市值：</span>
            {ALL_TIERS.map(t => (
              <button key={t} onClick={() => toggleTier(t)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${selectedTiers.includes(t) ? "bg-purple-500/20 text-purple-400 border-purple-500/30" : "border-border text-muted-foreground hover:border-purple-500/30"}`}>
                {MARKET_CAP_TIER_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm">信号类型：</span>
              <Select value={signalTypeFilter} onValueChange={v => { setSignalTypeFilter(v as any); setPage(1); }}>
                <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">买入</SelectItem>
                  <SelectItem value="sell">卖出</SelectItem>
                  <SelectItem value="hold">持有</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">最低分：</span>
              <Input type="number" value={minScore} onChange={e => { setMinScore(Number(e.target.value)); setPage(1); }}
                className="w-16 h-7 text-xs" min={0} max={100} />
            </div>
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input placeholder="搜索股票..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-32 h-7 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
              <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
                <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="score">按评分</SelectItem>
                  <SelectItem value="symbol">按代码</SelectItem>
                  <SelectItem value="rsi">按RSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {viewMode === "table" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              共 {scanData?.total || 0} 条结果 · 第 {page} 页
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">加载中...</span>
              </div>
            ) : filteredResults.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Scan className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">暂无扫描结果</p>
                <p className="text-sm mt-1">点击「立即扫描」开始扫描股票池</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2 px-2">代码</th>
                        <th className="text-left py-2 px-2">名称</th>
                        <th className="text-left py-2 px-2">策略</th>
                        <th className="text-left py-2 px-2">信号</th>
                        <th className="text-left py-2 px-2 w-32">评分</th>
                        <th className="text-left py-2 px-2">RSI</th>
                        <th className="text-left py-2 px-2">量比</th>
                        <th className="text-left py-2 px-2">趋势</th>
                        <th className="text-left py-2 px-2">信号描述</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((r: any, i: number) => {
                        const isWatchlisted = watchlistMap.has(r.symbol);
                        const threshold = watchlistMap.get(r.symbol) ?? 80;
                        const isAlert = isWatchlisted && r.score >= threshold;
                        return (
                        <tr key={`${r.symbol}-${r.strategy}-${i}`} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${isAlert ? 'bg-red-500/10 border-red-500/30' : isWatchlisted ? 'bg-yellow-500/5 border-yellow-500/20' : ''}`}>
                          <td className="py-2 px-2 font-mono font-bold text-primary">
                            <span className="flex items-center gap-1">
                              {isWatchlisted && <span className="text-yellow-400" title="自选股">★</span>}
                              {r.symbol}
                              {isAlert && <span className="text-xs text-red-400 font-normal">超阈値</span>}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">{r.name}</td>
                          <td className="py-2 px-2">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{STRATEGY_LABELS[r.strategy] || r.strategy}</span>
                          </td>
                          <td className="py-2 px-2"><SignalBadge signal={r.signalType} /></td>
                          <td className="py-2 px-2 w-32"><ScoreBar score={r.score} /></td>
                          <td className="py-2 px-2 font-mono text-xs">{parseFloat(r.rsi || "0").toFixed(1)}</td>
                          <td className="py-2 px-2 font-mono text-xs">{parseFloat(r.volumeRatio || "1").toFixed(2)}x</td>
                          <td className="py-2 px-2"><TrendIcon trend={r.trend} /></td>
                          <td className="py-2 px-2 text-xs text-muted-foreground max-w-[200px] truncate">
                            {(r.signals || []).join(" · ")}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-muted-foreground">
                    显示 {(page - 1) * 50 + 1}-{Math.min(page * 50, scanData?.total || 0)} / {scanData?.total || 0}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPage(p => p + 1)} disabled={page * 50 >= (scanData?.total || 0)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Compare View */
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Columns className="w-4 h-4" />
              多策略横向对比视图 · {compareData.length} 只股票
            </CardTitle>
          </CardHeader>
          <CardContent>
            {compareData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>暂无数据，请先运行扫描</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-2 sticky left-0 bg-card">代码</th>
                      <th className="text-left py-2 px-2 sticky left-12 bg-card">名称</th>
                      {selectedStrategies.map(s => (
                        <th key={s} className="text-center py-2 px-2 min-w-[80px]">{STRATEGY_LABELS[s]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareData.slice(0, 100).map((row: any) => (
                      <tr key={row.symbol} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 px-2 font-mono font-bold text-primary sticky left-0 bg-card">{row.symbol}</td>
                        <td className="py-2 px-2 text-muted-foreground sticky left-12 bg-card">{row.name}</td>
                        {selectedStrategies.map(s => {
                          const r = row[s];
                          if (!r) return <td key={s} className="py-2 px-2 text-center text-muted-foreground/30">-</td>;
                          const color = r.signalType === "buy" ? "text-green-400" : r.signalType === "sell" ? "text-red-400" : "text-muted-foreground";
                          return (
                            <td key={s} className="py-2 px-2 text-center">
                              <div className={`font-bold ${color}`}>{r.score}</div>
                              <div className="text-muted-foreground/70 text-[10px]">{r.signalType === "buy" ? "买" : r.signalType === "sell" ? "卖" : "-"}</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History Archive View */}
      {viewMode === "history" && (
        <ScanHistoryViewer />
      )}
    </div>
  );
}
