import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown, Minus, BarChart2, Calendar, Activity } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const STRATEGY_LABELS: Record<string, string> = {
  standard: "标准",
  aggressive: "激进",
  ladder_cd_combo: "组合",
  mean_reversion: "均值",
  macd_volume: "MACD",
  bollinger_squeeze: "布林",
  vamr: "VAMR",
  rsi_reversal: "RSI反转",
};

const STRATEGY_COLORS: Record<string, string> = {
  standard: "#60a5fa",
  aggressive: "#f97316",
  ladder_cd_combo: "#a78bfa",
  mean_reversion: "#34d399",
  macd_volume: "#fbbf24",
  bollinger_squeeze: "#f472b6",
  vamr: "#22d3ee",
  rsi_reversal: "#fb7185",
};

const SIGNAL_COLORS = {
  buy: "#22c55e",
  sell: "#ef4444",
  hold: "#6b7280",
};

interface Props {
  initialSymbol?: string;
}

export function SymbolTrendViewer({ initialSymbol = "" }: Props) {
  const [symbolInput, setSymbolInput] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol);
  const [days, setDays] = useState(30);

  const { data, isLoading, error } = trpc.scanHistory.getSymbolTrend.useQuery(
    { symbol: activeSymbol, days },
    { enabled: !!activeSymbol }
  );

  const handleSearch = () => {
    const sym = symbolInput.trim().toUpperCase();
    if (sym) setActiveSymbol(sym);
  };

  // Build chart data: one point per date, with per-strategy scores
  const chartData = data?.dailyPoints.map(pt => {
    const row: Record<string, any> = {
      date: pt.date.slice(5), // MM-DD
      fullDate: pt.date,
      avgScore: pt.avgScore,
      maxScore: pt.maxScore,
      buyCount: pt.buyCount,
      sellCount: pt.sellCount,
    };
    // Add per-strategy scores
    for (const [strat, info] of Object.entries(pt.byStrategy)) {
      row[strat] = info.score;
    }
    return row;
  }) ?? [];

  const allStrategies = data?.strategies ?? [];

  const getSignalIcon = (signal: string) => {
    if (signal === "buy") return <TrendingUp className="w-3.5 h-3.5 text-green-400" />;
    if (signal === "sell") return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
    return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  };

  const getSignalBadge = (signal: string) => {
    if (signal === "buy") return "bg-green-500/20 text-green-400 border-green-500/40";
    if (signal === "sell") return "bg-red-500/20 text-red-400 border-red-500/40";
    return "bg-gray-500/20 text-gray-400 border-gray-500/40";
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded p-3 text-xs shadow-lg min-w-[160px]">
        <div className="font-bold text-foreground mb-2">{payload[0]?.payload?.fullDate}</div>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex justify-between gap-3 mb-0.5">
            <span style={{ color: p.color }}>{STRATEGY_LABELS[p.dataKey] ?? p.name}</span>
            <span className="font-mono font-bold">{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            跨日期信号追踪
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="输入股票代码，如 AAPL"
                value={symbolInput}
                onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="pl-8 h-9 font-mono uppercase text-sm"
              />
            </div>
            <Button size="sm" className="h-9 px-4" onClick={handleSearch}>
              查询
            </Button>
          </div>
          {/* Days selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">时间范围：</span>
            {[14, 30, 60, 90].map(d => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? "default" : "outline"}
                className="h-7 text-xs px-3"
                onClick={() => setDays(d)}
              >
                {d}天
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {isLoading && activeSymbol && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          正在加载 {activeSymbol} 的历史信号数据...
        </div>
      )}

      {/* No data */}
      {!isLoading && data && !data.hasData && (
        <Card className="bg-card border-border">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            <BarChart2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <div>过去 {days} 天内没有 <span className="font-mono font-bold text-foreground">{activeSymbol}</span> 的扫描记录</div>
            <div className="text-xs mt-1 opacity-70">该股票可能未在扫描范围内，或尚未执行扫描</div>
          </CardContent>
        </Card>
      )}

      {/* Data available */}
      {!isLoading && data?.hasData && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-muted-foreground">活跃天数</div>
                <div className="text-2xl font-bold text-foreground mt-1">{data.summary.activeDays}</div>
                <div className="text-xs text-muted-foreground">/ {days} 天</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-muted-foreground">买入信号</div>
                <div className="text-2xl font-bold text-green-400 mt-1">{data.summary.totalBuy}</div>
                <div className="text-xs text-muted-foreground">次</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-muted-foreground">卖出信号</div>
                <div className="text-2xl font-bold text-red-400 mt-1">{data.summary.totalSell}</div>
                <div className="text-xs text-muted-foreground">次</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-muted-foreground">最高分</div>
                <div className="text-2xl font-bold text-yellow-400 mt-1">{data.summary.maxScore}</div>
                <div className="text-xs text-muted-foreground">均分 {data.summary.avgScore}</div>
              </CardContent>
            </Card>
          </div>

          {/* Score trend chart */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                <span className="font-mono text-blue-400">{data.symbol}</span>
                <span className="text-muted-foreground font-normal">各策略分数走势（近 {days} 天）</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      formatter={(value) => (
                        <span style={{ fontSize: 11, color: STRATEGY_COLORS[value] ?? "#9ca3af" }}>
                          {STRATEGY_LABELS[value] ?? value}
                        </span>
                      )}
                    />
                    <ReferenceLine y={60} stroke="rgba(250,204,21,0.3)" strokeDasharray="4 4" />
                    {allStrategies.map(strat => (
                      <Line
                        key={strat}
                        type="monotone"
                        dataKey={strat}
                        stroke={STRATEGY_COLORS[strat] ?? "#9ca3af"}
                        strokeWidth={2}
                        dot={{ r: 3, fill: STRATEGY_COLORS[strat] ?? "#9ca3af" }}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">暂无图表数据</div>
              )}
            </CardContent>
          </Card>

          {/* Daily detail table */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                每日信号明细
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                {[...data.dailyPoints].reverse().map(pt => (
                  <div
                    key={pt.date}
                    className="flex items-center justify-between p-2.5 bg-muted/20 rounded hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{pt.date}</span>
                      <Badge className={`text-xs px-1.5 py-0 border ${getSignalBadge(pt.dominantSignal)}`}>
                        <span className="flex items-center gap-1">
                          {getSignalIcon(pt.dominantSignal)}
                          {pt.dominantSignal === "buy" ? "买入" : pt.dominantSignal === "sell" ? "卖出" : "持有"}
                        </span>
                      </Badge>
                      <div className="flex gap-1 flex-wrap">
                        {Object.entries(pt.byStrategy).map(([strat, info]) => (
                          <span
                            key={strat}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: `${STRATEGY_COLORS[strat] ?? "#9ca3af"}20`,
                              color: STRATEGY_COLORS[strat] ?? "#9ca3af",
                              border: `1px solid ${STRATEGY_COLORS[strat] ?? "#9ca3af"}40`,
                            }}
                          >
                            {STRATEGY_LABELS[strat] ?? strat}: {info.score}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-xs font-bold text-yellow-400">均分 {pt.avgScore}</div>
                      <div className="text-xs text-muted-foreground">{pt.totalStrategies} 策略</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Prompt when no symbol entered */}
      {!activeSymbol && (
        <Card className="bg-card border-border">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <div className="text-sm">输入股票代码查看近 {days} 天的信号变化趋势</div>
            <div className="text-xs mt-1 opacity-60">支持所有在 793 只股票池中的美股代码</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
