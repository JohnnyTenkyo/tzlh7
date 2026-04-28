import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, TrendingUp, TrendingDown, Search, X, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SymbolTrendViewer } from "./SymbolTrendViewer";

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

export function ScanHistoryViewer() {
  const [activeTab, setActiveTab] = useState<"history" | "trend">("history");
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("");
  const [selectedSignal, setSelectedSignal] = useState<string>("");
  const [symbolInput, setSymbolInput] = useState<string>("");
  const [symbolFilter, setSymbolFilter] = useState<string>("");

  const { data: availableDates } = trpc.scanHistory.getAvailableDates.useQuery({ limit: 30 });
  const { data: scanData, isLoading } = trpc.scanHistory.getByDate.useQuery(
    {
      date: selectedDate,
      strategy: selectedStrategy || undefined,
      signalType: (selectedSignal as any) || undefined,
      symbol: symbolFilter || undefined,
    },
    { enabled: !!selectedDate && activeTab === "history" }
  );
  const { data: stats } = trpc.scanHistory.getStatsByDate.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate && activeTab === "history" }
  );

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case "buy":
        return "bg-green-500/20 border-green-500/50 text-green-400";
      case "sell":
        return "bg-red-500/20 border-red-500/50 text-red-400";
      default:
        return "bg-gray-500/20 border-gray-500/50 text-gray-400";
    }
  };

  const getSignalLabel = (signal: string) => {
    if (signal === "buy") return "买入";
    if (signal === "sell") return "卖出";
    return "持有";
  };

  const getTrendIcon = (trend: string) => {
    if (trend === "up") return <TrendingUp className="h-3 w-3 text-green-400" />;
    if (trend === "down") return <TrendingDown className="h-3 w-3 text-red-400" />;
    return null;
  };

  const handleSymbolSearch = () => {
    setSymbolFilter(symbolInput.trim().toUpperCase());
  };

  const clearSymbolFilter = () => {
    setSymbolInput("");
    setSymbolFilter("");
  };

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border pb-2">
        <Button
          size="sm"
          variant={activeTab === "history" ? "default" : "ghost"}
          className="h-8 text-xs gap-1.5"
          onClick={() => setActiveTab("history")}
        >
          <Calendar className="h-3.5 w-3.5" />
          按日期查看
        </Button>
        <Button
          size="sm"
          variant={activeTab === "trend" ? "default" : "ghost"}
          className="h-8 text-xs gap-1.5"
          onClick={() => setActiveTab("trend")}
        >
          <Activity className="h-3.5 w-3.5" />
          跨日期追踪
        </Button>
      </div>

      {/* Trend view */}
      {activeTab === "trend" && <SymbolTrendViewer />}

      {/* History view */}
      {activeTab === "history" && (
        <>
          {/* Date selector */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                选择查看日期
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 rounded border border-border bg-muted text-foreground"
              />
              {availableDates && availableDates.dates.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {availableDates.dates.slice(0, 7).map((date) => (
                    <Button
                      key={date}
                      size="sm"
                      variant={selectedDate === date ? "default" : "outline"}
                      onClick={() => setSelectedDate(date)}
                    >
                      {date}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Statistics */}
          {stats && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-medium">{selectedDate} 扫描统计</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-lg font-bold text-blue-400">{stats.total}</div>
                    <div className="text-xs text-muted-foreground">总信号数</div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-lg font-bold text-green-400">{stats.buySignals}</div>
                    <div className="text-xs text-muted-foreground">买入信号</div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-lg font-bold text-red-400">{stats.sellSignals}</div>
                    <div className="text-xs text-muted-foreground">卖出信号</div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-lg font-bold text-yellow-400">{stats.avgScore}</div>
                    <div className="text-xs text-muted-foreground">平均分数</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm font-medium">筛选</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Symbol search */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">按股票代码查询</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="输入股票代码，如 AAPL"
                      value={symbolInput}
                      onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleSymbolSearch()}
                      className="pl-8 h-8 text-xs font-mono uppercase"
                    />
                  </div>
                  <Button size="sm" className="h-8" onClick={handleSymbolSearch}>查询</Button>
                  {symbolFilter && (
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={clearSymbolFilter}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                {symbolFilter && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">当前筛选：</span>
                    <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">{symbolFilter}</Badge>
                    <span className="text-muted-foreground">的历史记录</span>
                  </div>
                )}
              </div>

              {/* Signal type */}
              <div>
                <label className="text-xs text-muted-foreground">信号类型</label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {["", "buy", "sell", "hold"].map((signal) => (
                    <Button
                      key={signal}
                      size="sm"
                      variant={selectedSignal === signal ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setSelectedSignal(signal)}
                    >
                      {signal === "" ? "全部" : signal === "buy" ? "买入" : signal === "sell" ? "卖出" : "持有"}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Strategy filter */}
              <div>
                <label className="text-xs text-muted-foreground">策略</label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <Button
                    size="sm"
                    variant={selectedStrategy === "" ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setSelectedStrategy("")}
                  >
                    全部
                  </Button>
                  {Object.entries(STRATEGY_LABELS).map(([key, label]) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={selectedStrategy === key ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setSelectedStrategy(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {isLoading ? (
            <div className="text-muted-foreground text-center py-4">加载中...</div>
          ) : scanData && scanData.results.length > 0 ? (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <span>
                    扫描结果
                    {symbolFilter ? ` — ${symbolFilter}` : ""}
                    {" "}({scanData.total})
                  </span>
                  {symbolFilter && (
                    <span className="text-xs text-muted-foreground font-normal">
                      显示 {symbolFilter} 在 {selectedDate} 的所有策略信号
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {scanData.results.map((result, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 bg-muted/20 rounded text-xs hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="font-mono font-bold text-blue-400 w-14 shrink-0">{result.symbol}</span>
                        <Badge className={`${getSignalColor(result.signalType)} shrink-0`}>
                          {getSignalLabel(result.signalType)}
                        </Badge>
                        <span className="text-muted-foreground truncate">
                          {STRATEGY_LABELS[result.strategy] || result.strategy}
                        </span>
                        {result.trend && getTrendIcon(result.trend)}
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="font-bold text-yellow-400">分数: {result.score}</div>
                        {result.rsi && <div className="text-muted-foreground">RSI: {result.rsi}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="pt-6 pb-6 text-center text-muted-foreground">
                {symbolFilter
                  ? `${selectedDate} 没有 ${symbolFilter} 的扫描记录`
                  : "该日期没有扫描结果"}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
