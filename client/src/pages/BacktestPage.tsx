import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Play, BarChart2, Layers, Filter, Search, ChevronDown, ChevronUp,
  Trash2, Eye, GitCompare, RefreshCw, CheckSquare, AlertCircle,
  Download, Cpu, SlidersHorizontal, Info, X, Settings2
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

import {
  STOCK_POOL, SECTOR_LABELS, MARKET_CAP_TIER_LABELS, filterStocks, getMarketCapTier,
  type StockSector, type MarketCapTier
} from "@shared/stockPool";

// ─── Constants ────────────────────────────────────────────────────────────────
type StrategyKey = "standard" | "aggressive" | "ladder_cd_combo" | "mean_reversion" | "macd_volume" | "bollinger_squeeze" | "gemini_ai" | "vamr" | "ravts" | "rsi_reversal" | "macd_divergence";

const STRATEGY_COLORS: Record<StrategyKey, string> = {
  standard: "#3b82f6",
  aggressive: "#ef4444",
  ladder_cd_combo: "#f59e0b",
  mean_reversion: "#10b981",
  macd_volume: "#8b5cf6",
  bollinger_squeeze: "#06b6d4",
  gemini_ai: "#f97316",
  vamr: "#ec4899",
  ravts: "#84cc16",
  rsi_reversal: "#14b8a6",
  macd_divergence: "#f43f5e",
};

const COMPARE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#14b8a6"];

// Params stored as percentages (0-300 for take profit, 0-50 for stop loss, etc.)
// null = unlimited
interface StrategyParamState {
  stopLossPct: number | null;        // % (e.g. 8 = 8%)
  takeProfitPct: number | null;      // % (e.g. 20 = 20%)
  trailingStopPct: number | null;    // % trailing stop from peak (null = disabled)
  maxHoldingDays: number | null;     // days (null = unlimited)
  // strategy-specific
  [key: string]: number | null;
}

const DEFAULT_PARAMS: Record<string, StrategyParamState> = {
  standard: { stopLossPct: 8, takeProfitPct: 20, trailingStopPct: null, maxHoldingDays: null, cdScoreThreshold: 0 },
  aggressive: { stopLossPct: 6, takeProfitPct: 12, trailingStopPct: 4, maxHoldingDays: 30 },
  ladder_cd_combo: { stopLossPct: 7, takeProfitPct: 15, trailingStopPct: 5, maxHoldingDays: null },
  mean_reversion: { stopLossPct: 6, takeProfitPct: 10, trailingStopPct: null, maxHoldingDays: 20, rsiOversold: 30, rsiOverbought: 70, meanPeriod: 20 },
  macd_volume: { stopLossPct: 7, takeProfitPct: 15, trailingStopPct: 5, maxHoldingDays: null, volumeMultiplier: 1.5 },
  bollinger_squeeze: { stopLossPct: 6, takeProfitPct: 12, trailingStopPct: 4, maxHoldingDays: 15, bbPeriod: 20, bbMultiplier: 2 },
  gemini_ai: { stopLossPct: 8, takeProfitPct: 20, trailingStopPct: null, maxHoldingDays: null },
  vamr: { stopLossPct: 7, takeProfitPct: 20, trailingStopPct: 5, maxHoldingDays: null, volatilityPeriod: 14, momentumPeriod: 10, rsi4Threshold: 30 },
  ravts: { stopLossPct: 7, takeProfitPct: 18, trailingStopPct: 5, maxHoldingDays: null, emaPeriod: 20, volumeConfirmPct: 1.5 },
  rsi_reversal: { stopLossPct: 6, takeProfitPct: 15, trailingStopPct: null, maxHoldingDays: 20, rsiPeriod: 14, rsiReversal: 30 },
  macd_divergence: { stopLossPct: 7, takeProfitPct: 20, trailingStopPct: null, maxHoldingDays: null, macdDivergencePeriod: 20 },
};

// Strategy-specific extra params (non-risk params)
const EXTRA_PARAM_DEFS: Record<string, Array<{ key: string; label: string; min: number; max: number; step: number; format: (v: number) => string }>> = {
  standard: [
    { key: "cdScoreThreshold", label: "CD评分阈值", min: 0, max: 10, step: 0.5, format: v => `${v}分` },
  ],
  mean_reversion: [
    { key: "rsiOversold", label: "RSI超卖阈值", min: 15, max: 40, step: 1, format: v => `${v}` },
    { key: "rsiOverbought", label: "RSI超买阈值", min: 60, max: 85, step: 1, format: v => `${v}` },
    { key: "meanPeriod", label: "均值周期", min: 5, max: 60, step: 1, format: v => `${v}天` },
  ],
  macd_volume: [
    { key: "volumeMultiplier", label: "量能倍数", min: 1.0, max: 3.0, step: 0.1, format: v => `${v.toFixed(1)}x` },
  ],
  bollinger_squeeze: [
    { key: "bbPeriod", label: "布林带周期", min: 10, max: 50, step: 2, format: v => `${v}日` },
    { key: "bbMultiplier", label: "布林带倍数", min: 1.0, max: 3.0, step: 0.1, format: v => `${v.toFixed(1)}σ` },
  ],
  vamr: [
    { key: "volatilityPeriod", label: "ATR周期", min: 5, max: 30, step: 1, format: v => `${v}日` },
    { key: "momentumPeriod", label: "动量周期", min: 5, max: 30, step: 1, format: v => `${v}日` },
    { key: "rsi4Threshold", label: "RSI4超卖阈值", min: 15, max: 45, step: 1, format: v => `${v}` },
  ],
  ravts: [
    { key: "emaPeriod", label: "EMA周期", min: 5, max: 60, step: 1, format: v => `${v}日` },
    { key: "volumeConfirmPct", label: "量能确认倍数", min: 1.0, max: 3.0, step: 0.1, format: v => `${v.toFixed(1)}x` },
  ],
  rsi_reversal: [
    { key: "rsiPeriod", label: "RSI周期", min: 5, max: 30, step: 1, format: v => `${v}日` },
    { key: "rsiReversal", label: "RSI反转阈值", min: 15, max: 45, step: 1, format: v => `${v}` },
  ],
  macd_divergence: [
    { key: "macdDivergencePeriod", label: "MACD背离回望期", min: 5, max: 50, step: 1, format: v => `${v}日` },
  ],
};

// ─── RiskParamPanel: stop loss / take profit / trailing stop / max holding ────
function RiskParamPanel({
  params,
  onChange,
}: {
  params: StrategyParamState;
  onChange: (key: string, value: number | null) => void;
}) {
  const [customTakeProfit, setCustomTakeProfit] = useState("");
  const [showCustomTP, setShowCustomTP] = useState(false);

  return (
    <div className="space-y-5">
      {/* Stop Loss */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">止损比例</Label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={params.stopLossPct === null}
                onCheckedChange={(checked) => onChange("stopLossPct", checked ? null : 8)}
                className="scale-75 origin-right"
              />
              <span className="text-[10px] text-muted-foreground">不限</span>
            </div>
            <span className={`text-xs font-mono font-semibold min-w-[40px] text-right ${params.stopLossPct === null ? "text-yellow-400" : "text-red-400"}`}>
              {params.stopLossPct === null ? "不限" : `${params.stopLossPct}%`}
            </span>
          </div>
        </div>
        <Slider
          disabled={params.stopLossPct === null}
          min={1} max={50} step={0.5}
          value={[params.stopLossPct ?? 8]}
          onValueChange={([v]) => onChange("stopLossPct", v)}
          className={params.stopLossPct === null ? "opacity-30" : ""}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>1%</span><span>50%</span>
        </div>
      </div>

      {/* Take Profit */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">止盈比例</Label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={params.takeProfitPct === null}
                onCheckedChange={(checked) => onChange("takeProfitPct", checked ? null : 20)}
                className="scale-75 origin-right"
              />
              <span className="text-[10px] text-muted-foreground">不限</span>
            </div>
            <button
              onClick={() => setShowCustomTP(!showCustomTP)}
              className="text-[10px] text-muted-foreground hover:text-primary px-1"
              title="手动输入更高止盈值"
              disabled={params.takeProfitPct === null}
            >
              ✎
            </button>
            <span className={`text-xs font-mono font-semibold min-w-[40px] text-right ${params.takeProfitPct === null ? "text-yellow-400" : "text-green-400"}`}>
              {params.takeProfitPct === null ? "不限" : `${params.takeProfitPct}%`}
            </span>
          </div>
        </div>
        {showCustomTP && params.takeProfitPct !== null && (
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="输入止盈% (如 500)"
              value={customTakeProfit}
              onChange={(e) => setCustomTakeProfit(e.target.value)}
              className="h-7 text-xs"
              min={1}
            />
            <Button
              size="sm" variant="outline" className="h-7 text-xs shrink-0"
              onClick={() => {
                const v = parseFloat(customTakeProfit);
                if (!isNaN(v) && v > 0) { onChange("takeProfitPct", v); setShowCustomTP(false); setCustomTakeProfit(""); }
              }}
            >
              确认
            </Button>
          </div>
        )}
        <Slider
          disabled={params.takeProfitPct === null}
          min={1} max={300} step={1}
          value={[Math.min(params.takeProfitPct ?? 20, 300)]}
          onValueChange={([v]) => onChange("takeProfitPct", v)}
          className={params.takeProfitPct === null ? "opacity-30" : ""}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>1%</span>
          <span className="text-primary/60">支持手动输入更高值 ✎</span>
          <span>300%+</span>
        </div>
      </div>

      {/* Trailing Stop */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">移动止损（从盈利峰值回撤触发）</Label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={params.trailingStopPct === null}
                onCheckedChange={(checked) => onChange("trailingStopPct", checked ? null : 5)}
                className="scale-75 origin-right"
              />
              <span className="text-[10px] text-muted-foreground">关闭</span>
            </div>
            <span className={`text-xs font-mono font-semibold min-w-[40px] text-right ${params.trailingStopPct === null ? "text-muted-foreground" : "text-orange-400"}`}>
              {params.trailingStopPct === null ? "关闭" : `${params.trailingStopPct}%`}
            </span>
          </div>
        </div>
        <Slider
          disabled={params.trailingStopPct === null}
          min={1} max={30} step={0.5}
          value={[params.trailingStopPct ?? 5]}
          onValueChange={([v]) => onChange("trailingStopPct", v)}
          className={params.trailingStopPct === null ? "opacity-30" : ""}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>1%</span>
          <span>从最高盈利点回撤此比例时触发卖出</span>
          <span>30%</span>
        </div>
      </div>

      {/* Max Holding Days */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">最大持仓天数</Label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={params.maxHoldingDays === null}
                onCheckedChange={(checked) => onChange("maxHoldingDays", checked ? null : 30)}
                className="scale-75 origin-right"
              />
              <span className="text-[10px] text-muted-foreground">不限</span>
            </div>
            <span className={`text-xs font-mono font-semibold min-w-[40px] text-right ${params.maxHoldingDays === null ? "text-yellow-400" : "text-blue-400"}`}>
              {params.maxHoldingDays === null ? "不限" : `${params.maxHoldingDays}天`}
            </span>
          </div>
        </div>
        <Slider
          disabled={params.maxHoldingDays === null}
          min={1} max={365} step={1}
          value={[params.maxHoldingDays ?? 30]}
          onValueChange={([v]) => onChange("maxHoldingDays", v)}
          className={params.maxHoldingDays === null ? "opacity-30" : ""}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>1天</span><span>365天</span>
        </div>
      </div>
    </div>
  );
}

// ─── Stock Pool Preset helpers ───────────────────────────────────────────────────
const PRESET_STORAGE_KEY = "tzlh_stock_pool_presets_v1";
interface StockPoolPreset {
  id: string;
  name: string;
  sectors: StockSector[];
  capTiers: MarketCapTier[];
  createdAt: number;
}
function loadPresets(): StockPoolPreset[] {
  try { return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "[]"); } catch { return []; }
}
function savePresetsToStorage(presets: StockPoolPreset[]) {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
}
// ─── Stock Pool Selector (Multi-select overlapping) ───────────────────────────
function StockPoolSelector({ selectedSymbols, onChange }: { selectedSymbols: string[]; onChange: (s: string[]) => void }) {
  const [selectedSectors, setSelectedSectors] = useState<StockSector[]>([]);
  const [selectedCapTiers, setSelectedCapTiers] = useState<MarketCapTier[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const [presets, setPresets] = useState<StockPoolPreset[]>(() => loadPresets());
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [presetName, setPresetName] = useState("");

  const sectorStats = useMemo(() => {
    const counts: Partial<Record<StockSector, number>> = {};
    for (const s of STOCK_POOL) {
      for (const sec of s.sectors) counts[sec] = (counts[sec] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([k, v]) => ({ key: k as StockSector, count: v as number, label: SECTOR_LABELS[k as StockSector] || k }));
  }, []);

  const capTierStats = useMemo(() => {
    const counts: Partial<Record<MarketCapTier, number>> = {};
    for (const s of STOCK_POOL) {
      const tier = getMarketCapTier(s.marketCap);
      counts[tier] = (counts[tier] || 0) + 1;
    }
    return counts;
  }, []);

  const filteredStocks = useMemo(() => {
    if (useCustom) {
      const syms = customInput.split(/[\s,，\n]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (syms.length === 0) return STOCK_POOL;
      return STOCK_POOL.filter(s => syms.includes(s.symbol));
    }
    return filterStocks(STOCK_POOL, {
      sectors: selectedSectors.length > 0 ? selectedSectors : undefined,
      marketCapTiers: selectedCapTiers.length > 0 ? selectedCapTiers : undefined,
      searchQuery: searchQuery || undefined,
    });
  }, [selectedSectors, selectedCapTiers, customInput, searchQuery, useCustom]);

  const apply = useCallback(() => {
    const syms = filteredStocks.map(s => s.symbol);
    onChange(syms);
    toast.success(`已选择 ${syms.length} 只股票`);
  }, [filteredStocks, onChange]);

  const toggleSector = (sec: StockSector) =>
    setSelectedSectors(prev => prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]);

  const toggleCapTier = (tier: MarketCapTier) =>
    setSelectedCapTiers(prev => prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]);

  const clearAll = () => {
    setSelectedSectors([]);
    setSelectedCapTiers([]);
    setCustomInput("");
    setSearchQuery("");
    setUseCustom(false);
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) { toast.error("请输入预设名称"); return; }
    if (selectedSectors.length === 0 && selectedCapTiers.length === 0) { toast.error("请先选择至少一个板块或市值区间"); return; }
    const newPreset: StockPoolPreset = {
      id: Date.now().toString(),
      name,
      sectors: [...selectedSectors],
      capTiers: [...selectedCapTiers],
      createdAt: Date.now(),
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    savePresetsToStorage(updated);
    setPresetName("");
    toast.success(`预设「${name}」已保存`);
  };

  const loadPreset = (preset: StockPoolPreset) => {
    setSelectedSectors(preset.sectors);
    setSelectedCapTiers(preset.capTiers);
    setUseCustom(false);
    toast.success(`已加载预设「${preset.name}」`);
  };

  const deletePreset = (id: string) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    savePresetsToStorage(updated);
  };

  const ALL_TIERS: MarketCapTier[] = ['unicorn', 'mega', 'large', 'mid', 'small', 'micro'];
  const TIER_COLORS: Record<MarketCapTier, string> = {
    unicorn: "#f97316",
    mega: "#8b5cf6",
    large: "#3b82f6",
    mid: "#10b981",
    small: "#f59e0b",
    micro: "#6b7280",
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          股票池筛选
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setShowPresetPanel(!showPresetPanel)}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                showPresetPanel ? "border-primary text-primary bg-primary/10" : "border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary"
              }`}
            >
              <Settings2 className="w-3 h-3" />
              预设{presets.length > 0 && <span className="ml-0.5 bg-primary/20 text-primary rounded-full px-1">{presets.length}</span>}
            </button>
            {/* Show both filtered count (live) and applied count */}
            <Badge variant="outline" className="text-xs text-primary border-primary/50">筛选: {filteredStocks.length} 只</Badge>
            <Badge variant="secondary" className="text-xs">已应用: {selectedSymbols.length} 只</Badge>
          </div>
        </CardTitle>
        <CardDescription className="text-xs">支持行业板块 + 市值区间多选叠加筛选（AND 逻辑）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Preset Panel */}
        {showPresetPanel && (
          <div className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/20">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">筛选预设管理</p>
            {/* Saved presets list */}
            {presets.length > 0 ? (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {presets.map(p => (
                  <div key={p.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => loadPreset(p)}
                      className="flex-1 text-left px-2 py-1.5 rounded text-xs border border-border/40 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    >
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="ml-2 text-muted-foreground text-[10px]">
                        {p.sectors.map(s => SECTOR_LABELS[s]).join("+")}
                        {p.capTiers.length > 0 && ` · ${p.capTiers.map(t => MARKET_CAP_TIER_LABELS[t].split(" ")[0]).join("+")}`}
                      </span>
                    </button>
                    <button
                      onClick={() => deletePreset(p.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground text-center py-2">暂无预设，请先设置筛选条件并保存</p>
            )}
            {/* Save current as preset */}
            <div className="flex gap-1.5 pt-1 border-t border-border/30">
              <Input
                placeholder="预设名称（如：大盘科技股）"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && savePreset()}
                className="h-7 text-xs flex-1"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={savePreset}>
                保存当前
              </Button>
            </div>
          </div>
        )}
        {/* Sector multi-select */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs text-muted-foreground">行业板块（多选叠加）</Label>
            {selectedSectors.length > 0 && (
              <button onClick={() => setSelectedSectors([])} className="text-[10px] text-muted-foreground hover:text-primary">
                清除 ({selectedSectors.length})
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {sectorStats.map(({ key, count, label }) => (
              <button key={key} onClick={() => toggleSector(key)}
                className={`flex items-center justify-between px-2 py-1.5 rounded text-xs border transition-colors ${
                  selectedSectors.includes(key)
                    ? "bg-primary/20 border-primary text-primary"
                    : "border-border/40 hover:border-primary/50 text-muted-foreground hover:text-foreground"
                }`}>
                <span className="truncate">{label}</span>
                <span className="ml-1 shrink-0 opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Market cap tier multi-select (6 tiers) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs text-muted-foreground">市值区间（多选叠加）</Label>
            {selectedCapTiers.length > 0 && (
              <button onClick={() => setSelectedCapTiers([])} className="text-[10px] text-muted-foreground hover:text-primary">
                清除 ({selectedCapTiers.length})
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_TIERS.map(tier => (
              <button key={tier} onClick={() => toggleCapTier(tier)}
                className={`flex items-center justify-between px-2.5 py-2 rounded border text-xs transition-colors ${
                  selectedCapTiers.includes(tier)
                    ? "border-opacity-100 text-white"
                    : "border-border/40 text-muted-foreground hover:text-foreground"
                }`}
                style={selectedCapTiers.includes(tier) ? {
                  backgroundColor: TIER_COLORS[tier] + "33",
                  borderColor: TIER_COLORS[tier],
                  color: TIER_COLORS[tier],
                } : {}}>
                <span className="font-medium truncate">{MARKET_CAP_TIER_LABELS[tier].split(" ")[0]}</span>
                <span className="text-[10px] opacity-70 ml-1 shrink-0">{capTierStats[tier] || 0}</span>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
            <div>独角兽 5000亿+ · 超大盘 1000-5000亿 · 大盘 500-1000亿</div>
            <div>中盘 100-500亿 · 小盘 10-100亿 · 微盘 0-10亿</div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="搜索股票代码/名称..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="pl-7 h-7 text-xs" />
        </div>

        {/* Custom symbols */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Switch checked={useCustom} onCheckedChange={setUseCustom} className="scale-75" />
            <Label className="text-xs text-muted-foreground">手动输入特定股票（覆盖上方筛选）</Label>
          </div>
          {useCustom && (
            <textarea value={customInput} onChange={e => setCustomInput(e.target.value)}
              placeholder="例如: AAPL MSFT NVDA TSLA AMZN&#10;GOOGL META AMD NFLX"
              className="w-full h-16 px-3 py-2 text-xs bg-background border border-border/50 rounded resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
          )}
        </div>

        {/* Preview & Apply */}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-7"
            onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
            预览 ({filteredStocks.length})
          </Button>
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={clearAll}>
            <X className="w-3 h-3 mr-1" />清除筛选
          </Button>
          <Button size="sm" className="text-xs h-7 flex-1" onClick={apply}>
            <CheckSquare className="w-3 h-3 mr-1" />应用筛选
          </Button>
        </div>

        {showPreview && (
          <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1 p-2 bg-muted/30 rounded">
            {filteredStocks.slice(0, 80).map(s => (
              <Badge key={s.symbol} variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{s.symbol}</Badge>
            ))}
            {filteredStocks.length > 80 && (
              <Badge variant="secondary" className="text-[10px]">+{filteredStocks.length - 80} 更多</Badge>
            )}
          </div>
        )}

        {/* Active filters summary */}
        {(selectedSectors.length > 0 || selectedCapTiers.length > 0) && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-border/30">
            {selectedSectors.map(s => (
              <Badge key={s} variant="outline" className="text-[10px] text-primary border-primary/50 px-1.5 py-0 cursor-pointer"
                onClick={() => toggleSector(s)}>
                {SECTOR_LABELS[s]} ×
              </Badge>
            ))}
            {selectedCapTiers.map(t => (
              <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer"
                style={{ borderColor: TIER_COLORS[t], color: TIER_COLORS[t] }}
                onClick={() => toggleCapTier(t)}>
                {MARKET_CAP_TIER_LABELS[t].split(" ")[0]} ×
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Compare Records Panel ────────────────────────────────────────────────────
function CompareRecordsPanel({ sessions }: { sessions: any[] }) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data: compareData, isLoading } = trpc.backtest.compareRecords.useQuery(
    { ids: selectedIds },
    { enabled: selectedIds.length >= 2 }
  );

  const toggleSelect = (id: number) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : prev.length < 10 ? [...prev, id] : prev);

  const completedSessions = sessions.filter(s => s.status === "completed");

  const chartData = useMemo(() => {
    if (!compareData?.sessions) return [];
    const curves = compareData.sessions.filter((s: any) => s.equityCurve?.length > 0);
    if (curves.length === 0) return [];
    const maxLen = Math.max(...curves.map((s: any) => s.equityCurve.length));
    return Array.from({ length: maxLen }, (_, i) => {
      const pt: any = { i };
      for (const s of curves) {
        const idx = Math.min(i, s.equityCurve.length - 1);
        const init = s.initialCapital;
        pt[s.id] = init > 0 ? ((s.equityCurve[idx].equity - init) / init * 100) : 0;
      }
      return pt;
    });
  }, [compareData]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">选择 2-10 条已完成的回测记录进行横向对比</p>

      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {completedSessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-40" />暂无已完成的回测记录
          </div>
        ) : completedSessions.map((s, idx) => {
          const isSelected = selectedIds.includes(s.id);
          const ret = Number(s.totalReturnPct) * 100;
          return (
            <div key={s.id} onClick={() => toggleSelect(s.id)}
              className={`flex items-center gap-2.5 p-2.5 rounded border cursor-pointer transition-colors ${
                isSelected ? "bg-primary/10 border-primary/50" : "border-border/30 hover:border-border/60"
              }`}>
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                isSelected ? "bg-primary border-primary" : "border-muted-foreground"
              }`}>
                <span className="text-[8px] text-primary-foreground font-bold">{isSelected ? "✓" : ""}</span>
              </div>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COMPARE_COLORS[idx % COMPARE_COLORS.length] }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{s.name}</div>
                <div className="text-[10px] text-muted-foreground">{s.strategy} · {s.startDate}~{s.endDate}</div>
              </div>
              <span className={`text-xs font-mono font-bold shrink-0 ${ret >= 0 ? "text-green-400" : "text-red-400"}`}>
                {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      {selectedIds.length >= 2 && (
        isLoading ? (
          <div key="compare-loading" className="text-center py-4 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />加载对比数据...
          </div>
        ) : compareData ? (
          <div key="compare-data" className="space-y-4">
            {/* Metrics table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 pr-3 text-muted-foreground font-normal w-24">指标</th>
                    {compareData.sessions.map((s: any, i: number) => (
                      <th key={s.id} className="text-right py-2 px-2 font-medium text-xs" style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>
                        {s.name.replace("[对比] ", "").split(" - ").slice(-1)[0] || s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {[
                    { label: "总收益率", key: "totalReturnPct", fmt: (v: any) => `${(v * 100).toFixed(2)}%`, best: "max" },
                    { label: "胜率", key: "winRate", fmt: (v: any) => `${(v * 100).toFixed(1)}%`, best: "max" },
                    { label: "最大回撤", key: "maxDrawdown", fmt: (v: any) => `-${(v * 100).toFixed(2)}%`, best: "min" },
                    { label: "夏普比率", key: "sharpeRatio", fmt: (v: any) => Number(v).toFixed(3), best: "max" },
                    { label: "总交易数", key: "totalTrades", fmt: (v: any) => String(v), best: null },
                    { label: "止损设置", key: "stopLoss", fmt: (v: any) => v == null ? "不限" : `${(v * 100).toFixed(0)}%`, best: null },
                    { label: "止盈设置", key: "takeProfit", fmt: (v: any) => v == null ? "不限" : `${(v * 100).toFixed(0)}%`, best: null },
                    { label: "移动止损", key: "trailingStop", fmt: (v: any) => v == null ? "关闭" : `${(v * 100).toFixed(0)}%`, best: null },
                    { label: "策略", key: "strategy", fmt: (v: any) => String(v), best: null },
                  ].map((metric: { label: string; key: string; fmt: (v: any) => string; best: string | null }) => {
                    const vals = compareData.sessions.map((s: any) => (s as any)[metric.key]);
                    const numVals = vals.filter((v: any) => typeof v === "number") as number[];
                    const bestVal = metric.best === "max" ? Math.max(...numVals) : metric.best === "min" ? Math.min(...numVals) : null;
                    return (
                      <tr key={metric.key}>
                        <td className="py-1.5 pr-3 text-muted-foreground">{metric.label}</td>
                        {compareData.sessions.map((s: any, i: number) => {
                          const val = (s as any)[metric.key];
                          const isBest = bestVal !== null && typeof val === "number" && val === bestVal;
                          return (
                            <td key={s.id} className={`py-1.5 px-2 text-right font-mono ${isBest ? "text-green-400 font-bold" : ""}`}>
                              {typeof val === "string" ? val : metric.fmt(val as any)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Equity curve chart */}
            {chartData.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">收益率曲线对比</p>
                {/* Use a stable key derived from session IDs to force full remount when sessions change.
                    This prevents React reconciliation from attempting DOM insertBefore on mismatched nodes. */}
                <ResponsiveContainer key={compareData.sessions.map((s: any) => s.id).join("-")} width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="i" hide />
                    <YAxis tickFormatter={v => `${Number(v).toFixed(0)}%`} tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v: any, name: any) => {
                        const s = compareData.sessions.find((s: any) => String(s.id) === String(name));
                        return [`${Number(v).toFixed(2)}%`, s?.name.split(" - ").slice(-1)[0] || name];
                      }}
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #333", fontSize: 10 }}
                    />
                    <Legend formatter={(v) => {
                      const s = compareData.sessions.find((s: any) => String(s.id) === String(v));
                      return s?.name.split(" - ").slice(-1)[0] || v;
                    }} wrapperStyle={{ fontSize: 10 }} />
                    {compareData.sessions.map((s: any, i: number) => (
                      <Line key={s.id} type="monotone" dataKey={String(s.id)}
                        stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]} dot={false} strokeWidth={1.5} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : null
      )}
    </div>
  );
}

// ─── Main BacktestPage ────────────────────────────────────────────────────────
export default function BacktestPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  // Form state
  const [name, setName] = useState(`回测_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "")}`);
  const [strategy, setStrategy] = useState<StrategyKey>("standard");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(STOCK_POOL.map(s => s.symbol));
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().split("T")[0]; });
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [initialCapital, setInitialCapital] = useState(100000);
  const [maxPositionPct, setMaxPositionPct] = useState(10);

  // Strategy params with null support
  const [strategyParams, setStrategyParams] = useState<StrategyParamState>({ ...DEFAULT_PARAMS["standard"] });
  // Multi-strategy independent params
  const [compareStrategyParams, setCompareStrategyParams] = useState<Record<StrategyKey, StrategyParamState>>({
    standard: { ...DEFAULT_PARAMS["standard"] },
    aggressive: { ...DEFAULT_PARAMS["aggressive"] },
    ladder_cd_combo: { ...DEFAULT_PARAMS["ladder_cd_combo"] },
    mean_reversion: { ...DEFAULT_PARAMS["mean_reversion"] },
    macd_volume: { ...DEFAULT_PARAMS["macd_volume"] },
    bollinger_squeeze: { ...DEFAULT_PARAMS["bollinger_squeeze"] },
    gemini_ai: { ...DEFAULT_PARAMS["gemini_ai"] },
    vamr: { ...DEFAULT_PARAMS["vamr"] },
    ravts: { ...DEFAULT_PARAMS["ravts"] },
    rsi_reversal: { ...DEFAULT_PARAMS["rsi_reversal"] },
    macd_divergence: { ...DEFAULT_PARAMS["macd_divergence"] },
  });

  // Multi-strategy compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareStrategies, setCompareStrategies] = useState<StrategyKey[]>(["standard", "aggressive", "vamr", "ravts", "rsi_reversal", "macd_divergence"]);
  const [activeConfigTab, setActiveConfigTab] = useState("config");
  const [historySubTab, setHistorySubTab] = useState("list");
  const [exportingIds, setExportingIds] = useState<Set<number>>(new Set());

  const { data: strategiesData } = trpc.backtest.strategies.useQuery();
  const { data: historyData, isLoading: historyLoading } = trpc.backtest.list.useQuery(undefined, {
    enabled: isAuthenticated, refetchInterval: 5000,
  });

  const createMutation = trpc.backtest.create.useMutation({
    onSuccess: ({ sessionId }) => {
      toast.success("回测已启动！正在跳转到详情页...", { duration: 3000 });
      utils.backtest.list.invalidate();
      setTimeout(() => navigate(`/backtest/${sessionId}`), 600);
    },
    onError: (err: any) => toast.error(`回测启动失败：${err.message}`),
  });

  const compareStrategiesMutation = trpc.backtest.compareStrategies.useMutation({
    onSuccess: (data) => {
      toast.success(`✅ ${data.count} 个策略对比回测已启动！可在历史记录中查看进度`, { duration: 4000 });
      utils.backtest.list.invalidate();
      setActiveConfigTab("history");
    },
    onError: (err: any) => toast.error(`对比回测启动失败：${err.message}`),
  });

  const deleteMutation = trpc.backtest.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.backtest.list.invalidate(); },
    onError: (err: any) => toast.error(err.message),
  });

  const exportMutation = trpc.backtest.exportExcel.useMutation({});

  const handleExportExcel = async (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (exportingIds.has(id)) return;
    setExportingIds(prev => { const s = new Set(prev); s.add(id); return s; });
    try {
      const data = await exportMutation.mutateAsync({ id });
      const blob = new Blob([Buffer.from(data.base64, "base64")], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = data.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel 导出成功！");
    } catch (err: any) {
      toast.error(err.message || "导出失败");
    } finally {
      setExportingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const aiAnalyzeMutation = trpc.backtest.aiAnalyze.useMutation({
    onSuccess: () => { toast.success("AI 分析完成！"); utils.backtest.list.invalidate(); },
    onError: (err: any) => toast.error(err.message),
  });

  const handleStrategyChange = (key: StrategyKey) => {
    setStrategy(key);
    const defaultParams = DEFAULT_PARAMS[key as string];
    setStrategyParams(defaultParams || DEFAULT_PARAMS["standard"]);
  };

  const handleParamChange = (key: string, value: number | null) => {
    setStrategyParams(prev => ({ ...prev, [key]: value }));
  };

  const handleCompareParamChange = (strategy: StrategyKey, key: string, value: number | null) => {
    setCompareStrategyParams(prev => ({
      ...prev,
      [strategy]: { ...prev[strategy], [key]: value }
    }));
  };

  // Convert UI params (percentages as integers) to backend params (decimals)
  const buildBackendParams = () => {
    const result: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(strategyParams)) {
      if (k === "stopLossPct" || k === "takeProfitPct" || k === "trailingStopPct") {
        result[k] = v === null ? null : v / 100;
      } else {
        result[k] = v;
      }
    }
    return result;
  };

  const buildCompareBackendParams = () => {
    const result: Record<string, any> = {};
    for (const [strategy, params] of Object.entries(compareStrategyParams)) {
      const converted: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(params)) {
        if (k === "stopLossPct" || k === "takeProfitPct" || k === "trailingStopPct") {
          converted[k] = v === null ? null : (v as number) / 100;
        } else {
          converted[k] = v;
        }
      }
      result[strategy] = converted;
    }
    return result;
  };

  const handleSubmit = () => {
    if (!isAuthenticated) { toast.error("请先登录"); return; }
    if (selectedSymbols.length === 0) { toast.error("请选择至少一只股票"); return; }
    const params = buildBackendParams();
    if (compareMode) {
      if (compareStrategies.length < 2) { toast.error("请选择至少2个策略进行对比"); return; }
      const compareParams = buildCompareBackendParams();
      compareStrategiesMutation.mutate({
        name, strategies: compareStrategies as any, symbols: selectedSymbols,
        startDate, endDate, initialCapital, maxPositionPct, strategyParams: compareParams as any,
      });
    } else {
      createMutation.mutate({
        name, strategy: strategy as any, symbols: selectedSymbols,
        startDate, endDate, initialCapital, maxPositionPct, strategyParams: params as any,
      });
    }
  };

  const toggleCompareStrategy = (key: StrategyKey) => {
    setCompareStrategies(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const strategies = strategiesData || [];
  const isSubmitting = createMutation.isPending || compareStrategiesMutation.isPending;

  const getStatusBadge = (status: string) => {
    if (status === "completed") return <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/50 px-1 py-0">完成</Badge>;
    if (status === "running") return <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-400/50 px-1 py-0">运行中</Badge>;
    if (status === "failed") return <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/50 px-1 py-0">失败</Badge>;
    return <Badge variant="outline" className="text-[10px] text-muted-foreground px-1 py-0">等待</Badge>;
  };

  // Quick presets
  const PRESETS = [
    { label: "AI科技 TOP", sectors: ["AI", "Semiconductor", "Cloud"] as StockSector[], caps: [] as MarketCapTier[] },
    { label: "大盘价值股", sectors: [] as StockSector[], caps: ["large", "mega", "unicorn"] as MarketCapTier[] },
    { label: "中小盘成长", sectors: [] as StockSector[], caps: ["mid", "small"] as MarketCapTier[] },
    { label: "能源+金融", sectors: ["Energy", "Finance"] as StockSector[], caps: [] as MarketCapTier[] },
    { label: "医疗健康", sectors: ["Healthcare", "Biotech"] as StockSector[], caps: [] as MarketCapTier[] },
    { label: "消费+零售", sectors: ["Consumer", "Retail"] as StockSector[], caps: [] as MarketCapTier[] },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />回测中心
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">多维筛选股票池，配置策略参数，运行历史回测</p>
        </div>
        {!isAuthenticated && (
          <Badge variant="outline" className="text-yellow-400 border-yellow-400/50 text-xs">
            <AlertCircle className="w-3 h-3 mr-1" />请先登录
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left: Config (2/3 width) ── */}
        <div className="lg:col-span-2">
          <Tabs value={activeConfigTab} onValueChange={setActiveConfigTab}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="config">基础配置</TabsTrigger>
              <TabsTrigger value="params">
                <SlidersHorizontal className="w-3 h-3 mr-1" />参数调优
              </TabsTrigger>
              <TabsTrigger value="history">历史记录</TabsTrigger>
            </TabsList>

            {/* ── Tab 1: Config ── */}
            <TabsContent value="config" className="space-y-4 mt-4">
              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-xs">回测名称</Label>
                <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
              </div>

              {/* Stock pool */}
              <StockPoolSelector selectedSymbols={selectedSymbols} onChange={setSelectedSymbols} />

              {/* Quick presets */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">快速预设</Label>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="text-xs h-7"
                    onClick={() => { setSelectedSymbols(STOCK_POOL.map(s => s.symbol)); toast.success(`已选全部 ${STOCK_POOL.length} 只`); }}>
                    全部股票
                  </Button>
                  {PRESETS.map(p => (
                    <Button key={p.label} size="sm" variant="outline" className="text-xs h-7"
                      onClick={() => {
                        const filtered = filterStocks(STOCK_POOL, {
                          sectors: p.sectors.length > 0 ? p.sectors : undefined,
                          marketCapTiers: p.caps.length > 0 ? p.caps : undefined,
                        });
                        setSelectedSymbols(filtered.map(s => s.symbol));
                        toast.success(`${p.label}：已选 ${filtered.length} 只`);
                      }}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Strategy */}
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />策略选择
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">多策略对比</span>
                      <button onClick={() => setCompareMode(!compareMode)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${compareMode ? "bg-primary" : "bg-muted"}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${compareMode ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {strategies.map(s => {
                      const isActive = compareMode ? compareStrategies.includes(s.key as StrategyKey) : strategy === s.key;
                      return (
                        <button key={s.key}
                          onClick={() => compareMode ? toggleCompareStrategy(s.key as StrategyKey) : handleStrategyChange(s.key as StrategyKey)}
                          className={`text-left p-3 rounded border transition-colors ${isActive ? "bg-primary/15 border-primary" : "border-border/30 hover:border-border"}`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                              compareMode ? "opacity-100" : "opacity-0 w-0 h-0 border-0 overflow-hidden pointer-events-none"
                            } ${isActive ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                              <span className="text-[7px] text-primary-foreground font-bold" style={{ visibility: isActive ? 'visible' : 'hidden' }}>✓</span>
                            </div>
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STRATEGY_COLORS[s.key as StrategyKey] || "#888" }} />
                            <span className="text-xs font-medium">{s.name}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className={`text-xs text-green-400 mt-2 ${compareMode && compareStrategies.length >= 2 ? 'block' : 'hidden'}`}>✓ 已选 {compareStrategies.length} 个策略，将并行运行并生成对比报告</p>
                </CardContent>
              </Card>

              {/* Date & Capital */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">开始日期</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">结束日期</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-8 text-sm" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="text-xs h-7"
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setFullYear(start.getFullYear() - 1);
                      setStartDate(start.toISOString().split("T")[0]);
                      setEndDate(end.toISOString().split("T")[0]);
                      toast.success("已设置为最近一年");
                    }}>
                    最近一年
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7"
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setMonth(start.getMonth() - 6);
                      setStartDate(start.toISOString().split("T")[0]);
                      setEndDate(end.toISOString().split("T")[0]);
                      toast.success("已设置为最近半年");
                    }}>
                    最近半年
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7"
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setMonth(start.getMonth() - 3);
                      setStartDate(start.toISOString().split("T")[0]);
                      setEndDate(end.toISOString().split("T")[0]);
                      toast.success("已设置为最近三个月");
                    }}>
                    最近三个月
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">初始资金 ($)</Label>
                  <Input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs">最大仓位比例</Label>
                    <span className="text-xs font-medium text-blue-400">{maxPositionPct}%</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      value={maxPositionPct} 
                      onChange={e => setMaxPositionPct(Number(e.target.value))}
                      className="flex-1 h-2 bg-border rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <Input 
                      type="number" 
                      min="1" 
                      max="100"
                      value={maxPositionPct} 
                      onChange={e => setMaxPositionPct(Math.min(100, Math.max(1, Number(e.target.value))))}
                      className="h-8 w-16 text-sm"
                    />
                  </div>
                </div>
              </div>


              {/* Submit */}
              <Button className="w-full" onClick={handleSubmit} disabled={isSubmitting || !isAuthenticated}>
                {isSubmitting ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />启动中...</>
                ) : compareMode ? (
                  <><GitCompare className="w-4 h-4 mr-2" />启动 {compareStrategies.length} 策略并行对比回测</>
                ) : (
                  <><Play className="w-4 h-4 mr-2" />启动回测</>
                )}
              </Button>
            </TabsContent>

            {/* ── Tab 2: Param Tuning ── */}
            <TabsContent value="params" className="mt-4">
              <div className="space-y-4">
                {/* Single strategy params - always rendered, hidden in compare mode */}
                <div className={compareMode ? 'hidden' : 'block'}>
                  <Card className="border-border/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Settings2 className="w-4 h-4 text-primary" />
                        风险控制参数
                      </CardTitle>
                      <CardDescription className="text-xs">
                        设为“不限”表示按策略信号出场，不设硬性止盈止损位。移动止损从盈利峰値回撤触发。
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <RiskParamPanel params={strategyParams} onChange={handleParamChange} />
                    </CardContent>
                  </Card>
                </div>
                {/* Compare mode params - always rendered, hidden in single mode */}
                <div className={compareMode ? 'block space-y-3' : 'hidden'}>
                  {compareStrategies.map(strategyKey => (
                    <Card key={strategyKey} className="border-border/50">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Settings2 className="w-4 h-4" style={{ color: STRATEGY_COLORS[strategyKey] }} />
                          {strategies.find(s => s.key === strategyKey)?.name || strategyKey}
                        </CardTitle>
                        <CardDescription className="text-xs">独立参数配置</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <RiskParamPanel 
                          params={compareStrategyParams[strategyKey]} 
                          onChange={(key, value) => handleCompareParamChange(strategyKey, key, value)} 
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Strategy-specific extra params */}
                {(EXTRA_PARAM_DEFS[strategy] || []).length > 0 && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">策略专属参数</CardTitle>
                      <CardDescription className="text-xs">
                        当前策略：{strategies.find(s => s.key === strategy)?.name || strategy}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(EXTRA_PARAM_DEFS[strategy] || []).map(def => {
                        const val = (strategyParams[def.key] ?? def.min) as number;
                        const defaultVal = (DEFAULT_PARAMS[strategy] as any)?.[def.key];
                        const isModified = val !== defaultVal;
                        return (
                          <div key={def.key} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <Label className="text-xs flex items-center gap-1">
                                {def.label}
                                {isModified && <Badge variant="outline" className="text-[10px] px-1 py-0 text-primary border-primary">已修改</Badge>}
                              </Label>
                              <span className="text-xs font-mono text-primary">{def.format(val)}</span>
                            </div>
                            <Slider min={def.min} max={def.max} step={def.step} value={[val]}
                              onValueChange={([v]) => handleParamChange(def.key, v)} />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>{def.format(def.min)}</span>
                              <span>默认: {def.format(defaultVal ?? def.min)}</span>
                              <span>{def.format(def.max)}</span>
                            </div>
                          </div>
                        );
                      })}
                      <Button size="sm" variant="ghost" className="text-xs w-full"
                        onClick={() => setStrategyParams({ ...(DEFAULT_PARAMS[strategy] || DEFAULT_PARAMS["standard"]) })}>
                        <RefreshCw className="w-3 h-3 mr-1" />重置为默认值
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* ── Tab 3: History ── */}
            <TabsContent value="history" className="mt-4">
              <Tabs value={historySubTab} onValueChange={setHistorySubTab}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="list">历史记录</TabsTrigger>
                  <TabsTrigger value="compare"><GitCompare className="w-3 h-3 mr-1" />记录对比</TabsTrigger>
                </TabsList>

                <TabsContent value="list" className="mt-3 space-y-2">
                  {!isAuthenticated ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">请先登录查看历史记录</div>
                  ) : historyLoading ? (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />加载中...
                    </div>
                  ) : !historyData?.length ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">暂无回测记录</div>
                  ) : (
                    historyData.map(s => {
                      const ret = Number(s.totalReturnPct) * 100;
                      const sp = typeof s.strategyParams === 'string' ? JSON.parse(s.strategyParams) : s.strategyParams as any;
                      return (
                        <div key={s.id} className="flex items-center gap-2.5 p-3 rounded border border-border/30 hover:border-border/60 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-xs font-medium truncate">{s.name}</span>
                              {getStatusBadge(s.status)}
                              {s.strategy === "gemini_ai" && <Cpu className="w-3 h-3 text-cyan-400 shrink-0" />}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {s.strategy} · {s.startDate}~{s.endDate} · {((s.symbols as string[]) || []).length} 只
                              {s.status === "running" && (
                                <span className="text-yellow-400 ml-1 animate-pulse">
                                  {s.progressMessage || (s.progress != null ? `${s.progress}%` : '运行中...')}
                                </span>
                              )}
                            </div>
                            {/* Show risk params summary */}
                            {sp && (
                              <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                                <span>止损: <span className={sp.stopLossPct == null ? "text-yellow-400" : ""}>{sp.stopLossPct == null ? "不限" : `${(sp.stopLossPct * 100).toFixed(1)}%`}</span></span>
                                <span>止盈: <span className={sp.takeProfitPct == null ? "text-yellow-400" : ""}>{sp.takeProfitPct == null ? "不限" : `${(sp.takeProfitPct * 100).toFixed(1)}%`}</span></span>
                                {sp.trailingStopPct != null && sp.trailingStopPct > 0 && <span>移动止损: <span className="text-orange-400">{(sp.trailingStopPct * 100).toFixed(1)}%</span></span>}
                                {sp.maxHoldingDays != null && sp.maxHoldingDays > 0 && <span>持仓天数: <span className="text-blue-400">{sp.maxHoldingDays}</span></span>}
                              </div>
                            )}
                          </div>
                          {s.status === "completed" && (
                            <span className={`text-xs font-mono font-bold shrink-0 ${ret >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
                            </span>
                          )}
                          <div className="flex gap-0.5 shrink-0">
                            {s.status === "running" && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-yellow-400 hover:text-yellow-300 text-[10px] gap-1" onClick={() => navigate(`/backtest/${s.id}`)} title="查看进度">
                                <RefreshCw className="w-3 h-3 animate-spin" />查看进度
                              </Button>
                            )}
                            {s.status === "completed" && (
                              <>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => navigate(`/backtest/${s.id}`)}>
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                                  onClick={(e) => handleExportExcel(s.id, e)} disabled={exportingIds.has(s.id)} title="导出Excel">
                                  {exportingIds.has(s.id) ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-cyan-400"
                                  onClick={() => aiAnalyzeMutation.mutate({ id: s.id })} disabled={aiAnalyzeMutation.isPending} title="AI 分析">
                                  <Cpu className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                              onClick={() => deleteMutation.mutate({ id: s.id })} disabled={deleteMutation.isPending}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </TabsContent>

                <TabsContent value="compare" className="mt-3">
                  <CompareRecordsPanel sessions={historyData || []} />
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Right: Summary (1/3 width) ── */}
        <div className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />配置摘要
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">股票数量</span>
                <span className="font-medium">{selectedSymbols.length} 只</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">策略</span>
                <span className="font-medium text-right max-w-[60%] truncate">
                  {compareMode
                    ? `${compareStrategies.length} 策略并行`
                    : strategies.find(s => s.key === strategy)?.name || strategy}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">回测区间</span>
                <span className="font-medium text-right">{startDate.slice(0, 7)} ~ {endDate.slice(0, 7)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">初始资金</span>
                <span className="font-medium">${initialCapital.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">最大仓位</span>
                <span className="font-medium">{maxPositionPct}%</span>
              </div>
              {/* Risk params summary */}
              <div className="pt-2 border-t border-border/30 space-y-1.5">
                <span className="text-muted-foreground">风险参数</span>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-[10px]">止损</span>
                    <span className={`font-medium text-[10px] ${strategyParams.stopLossPct === null ? "text-yellow-400" : "text-red-400"}`}>
                      {strategyParams.stopLossPct === null ? "不限（按信号）" : `${strategyParams.stopLossPct}%`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-[10px]">止盈</span>
                    <span className={`font-medium text-[10px] ${strategyParams.takeProfitPct === null ? "text-yellow-400" : "text-green-400"}`}>
                      {strategyParams.takeProfitPct === null ? "不限（按信号）" : `${strategyParams.takeProfitPct}%`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-[10px]">移动止损</span>
                    <span className={`font-medium text-[10px] ${strategyParams.trailingStopPct === null ? "text-muted-foreground" : "text-orange-400"}`}>
                      {strategyParams.trailingStopPct === null ? "关闭" : `${strategyParams.trailingStopPct}%`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-[10px]">持仓天数</span>
                    <span className={`font-medium text-[10px] ${strategyParams.maxHoldingDays === null ? "text-yellow-400" : "text-blue-400"}`}>
                      {strategyParams.maxHoldingDays === null ? "不限" : `${strategyParams.maxHoldingDays}天`}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent results */}
          {isAuthenticated && historyData && historyData.filter(s => s.status === "completed").length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">最近完成</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {historyData.filter(s => s.status === "completed").slice(0, 5).map(s => {
                  const ret = Number(s.totalReturnPct) * 100;
                  return (
                    <div key={s.id} className="flex items-center justify-between cursor-pointer hover:opacity-80"
                      onClick={() => navigate(`/backtest/${s.id}`)}>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs truncate">{s.name}</div>
                        <div className="text-[10px] text-muted-foreground">{s.strategy}</div>
                      </div>
                      <span className={`text-xs font-mono font-bold ml-2 shrink-0 ${ret >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
