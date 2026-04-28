import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Search, TrendingUp, TrendingDown, Cpu } from "lucide-react";
import { toast } from "sonner";

const TIMEFRAMES = [
  { value: "1d", label: "日线" },
  { value: "1w", label: "周线" },
  { value: "1mo", label: "月线" },
  { value: "1h", label: "1小时" },
  { value: "4h", label: "4小时" },
];

const POPULAR_SYMBOLS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "SPY", "QQQ", "BTC-USD"];

export default function ChartPage() {
  const [symbol, setSymbol] = useState("AAPL");
  const [inputSymbol, setInputSymbol] = useState("AAPL");
  const [timeframe, setTimeframe] = useState("1d");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);

  const { data: candleData, isLoading: candleLoading } = trpc.chart.getCandles.useQuery(
    { symbol, timeframe },
    { retry: 1, staleTime: 60000 }
  );

  const { data: indicatorData } = trpc.chart.getIndicators.useQuery(
    { symbol, timeframe },
    { retry: 1, staleTime: 60000 }
  );

  const { data: aiSignal, isLoading: aiLoading } = trpc.chart.getAISignal.useQuery(
    { symbol, timeframe },
    { retry: false, enabled: false }
  );

  const [showAI, setShowAI] = useState(false);
  const { refetch: fetchAI } = trpc.chart.getAISignal.useQuery(
    { symbol, timeframe },
    { retry: false, enabled: false }
  );

  const candles = candleData?.candles || [];
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const priceChange = lastCandle && prevCandle ? lastCandle.close - prevCandle.close : 0;
  const priceChangePct = prevCandle ? (priceChange / prevCandle.close) * 100 : 0;
  const isUp = priceChange >= 0;

  useEffect(() => {
    if (!chartContainerRef.current) return;
    let chart: any;
    let candleSeries: any;

    import("lightweight-charts").then(({ createChart, CandlestickSeries }) => {
      if (!chartContainerRef.current) return;
      chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 420,
        layout: {
          background: { color: "oklch(0.12 0.01 240)" },
          textColor: "oklch(0.60 0.01 240)",
        },
        grid: {
          vertLines: { color: "oklch(0.25 0.01 240)" },
          horzLines: { color: "oklch(0.25 0.01 240)" },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: "oklch(0.25 0.01 240)" },
        timeScale: { borderColor: "oklch(0.25 0.01 240)", timeVisible: true },
      });

      candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "oklch(0.65 0.18 140)",
        downColor: "oklch(0.65 0.18 25)",
        borderUpColor: "oklch(0.65 0.18 140)",
        borderDownColor: "oklch(0.65 0.18 25)",
        wickUpColor: "oklch(0.65 0.18 140)",
        wickDownColor: "oklch(0.65 0.18 25)",
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;

      const resizeObserver = new ResizeObserver(() => {
        if (chartContainerRef.current) {
          chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      });
      resizeObserver.observe(chartContainerRef.current);

      return () => resizeObserver.disconnect();
    });

    return () => {
      if (chart) chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;
    const data = candles.map(c => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(data);
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [candles]);

  const handleSearch = () => {
    if (inputSymbol.trim()) setSymbol(inputSymbol.trim().toUpperCase());
  };

  const handleAIAnalyze = async () => {
    setShowAI(true);
    await fetchAI();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">K线图表</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {POPULAR_SYMBOLS.slice(0, 5).map(s => (
              <Button
                key={s}
                variant={symbol === s ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => { setSymbol(s); setInputSymbol(s); }}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Search and Controls */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <Input
            value={inputSymbol}
            onChange={e => setInputSymbol(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="输入股票代码..."
            className="bg-input border-border max-w-[160px]"
          />
          <Button onClick={handleSearch} size="icon" variant="outline">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <Select value={timeframe} onValueChange={setTimeframe}>
          <SelectTrigger className="w-[100px] bg-input border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map(tf => (
              <SelectItem key={tf.value} value={tf.value}>{tf.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          onClick={handleAIAnalyze}
          disabled={aiLoading}
        >
          <Cpu className="h-4 w-4" />
          {aiLoading ? "AI分析中..." : "AI信号"}
        </Button>
      </div>

      {/* Price Info */}
      {lastCandle && (
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold">{symbol}</span>
          <span className="text-2xl font-bold">${lastCandle.close.toFixed(2)}</span>
          <span className={`flex items-center gap-1 text-sm font-medium ${isUp ? "text-gain" : "text-loss"}`}>
            {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isUp ? "+" : ""}{priceChange.toFixed(2)} ({isUp ? "+" : ""}{priceChangePct.toFixed(2)}%)
          </span>
          <span className="text-xs text-muted-foreground">
            O: {lastCandle.open.toFixed(2)} H: {lastCandle.high.toFixed(2)} L: {lastCandle.low.toFixed(2)} V: {(lastCandle.volume / 1e6).toFixed(1)}M
          </span>
        </div>
      )}

      {/* AI Signal */}
      {showAI && aiSignal && (
        <Card className="bg-card border-cyan-500/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Cpu className="h-5 w-5 text-cyan-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-cyan-400">Gemini AI 信号</span>
                  <Badge variant={aiSignal.signal === "buy" ? "default" : aiSignal.signal === "sell" ? "destructive" : "secondary"}>
                    {aiSignal.signal === "buy" ? "买入" : aiSignal.signal === "sell" ? "卖出" : "持有"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">置信度: {(aiSignal.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted-foreground">{aiSignal.reasoning}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">{symbol} - {TIMEFRAMES.find(t => t.value === timeframe)?.label}</CardTitle>
          {candleLoading && <span className="text-xs text-muted-foreground">加载中...</span>}
        </CardHeader>
        <CardContent className="p-0">
          <div ref={chartContainerRef} className="w-full" />
        </CardContent>
      </Card>

      {/* Indicators Summary */}
      {indicatorData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* MACD */}
          {indicatorData.macd && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">MACD</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {(() => {
                  const last = indicatorData.macd!.macd[indicatorData.macd!.macd.length - 1];
                  const lastDiff = indicatorData.macd!.diff[indicatorData.macd!.diff.length - 1];
                  return (
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">MACD</span>
                        <span className={last?.value >= 0 ? "text-gain" : "text-loss"}>{last?.value.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">DIFF</span>
                        <span className={lastDiff?.value >= 0 ? "text-gain" : "text-loss"}>{lastDiff?.value.toFixed(3)}</span>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Ladder */}
          {indicatorData.ladder && indicatorData.ladder.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">黄蓝梯子</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {(() => {
                  const last = indicatorData.ladder![indicatorData.ladder!.length - 1];
                  const isAboveBlue = lastCandle && last ? lastCandle.close > last.blueMid : false;
                  const isAboveYellow = lastCandle && last ? lastCandle.close > last.yellowMid : false;
                  return (
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">蓝线中轨</span>
                        <span className={isAboveBlue ? "text-gain" : "text-loss"}>{last?.blueMid.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">黄线中轨</span>
                        <span className={isAboveYellow ? "text-gain" : "text-loss"}>{last?.yellowMid.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* CD Signals */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">CD 抄底信号</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {indicatorData.cdSignals && indicatorData.cdSignals.length > 0 ? (
                <div className="space-y-1">
                  {indicatorData.cdSignals.slice(-3).map((sig: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{sig.time}</span>
                      <Badge variant={sig.type === "buy" ? "default" : "secondary"} className="text-xs h-4">
                        {sig.type === "buy" ? "买入" : "卖出"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无信号</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
