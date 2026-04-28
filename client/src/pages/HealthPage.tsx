import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  XCircle,
  Play,
  Edit2,
  Trash2,
  Plus,
  RefreshCw,
  Bot,
  Database,
  AlertCircle,
  Loader2,
  Activity,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

// Built-in data source metadata
const BUILTIN_SOURCES = [
  {
    id: "alpaca",
    name: "Alpaca",
    desc: "Alpaca Markets · 实时/历史数据",
    type: "付费",
    rateLimit: "200/min",
    priority: 1,
  },
  {
    id: "stooq",
    name: "Stooq",
    desc: "Stooq · 免费历史数据",
    type: "免费",
    rateLimit: "无限制",
    priority: 8,
  },
  {
    id: "yahoo",
    name: "Yahoo",
    desc: "Yahoo Finance · 免费历史数据",
    type: "免费",
    rateLimit: "2000/hour",
    priority: 2,
  },
  {
    id: "tiingo",
    name: "Tiingo",
    desc: "Tiingo · 免费/自定义定价",
    type: "免费/付费",
    rateLimit: "1000/hour",
    priority: 3,
  },
  {
    id: "finnhub",
    name: "Finnhub",
    desc: "Finnhub · 实时行情·基本面",
    type: "免费/付费",
    rateLimit: "60/min",
    priority: 4,
  },
  {
    id: "alphavantage",
    name: "Alphavantage",
    desc: "Alpha Vantage · 技术指标+分析",
    type: "免费/付费",
    rateLimit: "5/min",
    priority: 5,
  },
  {
    id: "polygon",
    name: "Polygon",
    desc: "Polygon.io · 实盘级市场数据",
    type: "免费/付费",
    rateLimit: "5/min",
    priority: 6,
  },
  {
    id: "twelvedata",
    name: "TwelveData",
    desc: "Twelve Data · 全球市场数据",
    type: "免费/付费",
    rateLimit: "8/min",
    priority: 7,
  },
  {
    id: "marketstack",
    name: "MarketStack",
    desc: "MarketStack · 全球股票数据",
    type: "免费/付费",
    rateLimit: "100/month",
    priority: 9,
  },
] as const;

type BuiltinSourceId = typeof BUILTIN_SOURCES[number]["id"];

type EditFormData = {
  name: string;
  provider: string;
  apiEndpoint: string;
  apiKey: string;
  description: string;
};

export default function HealthPage() {
  const [testingSource, setTestingSource] = useState<string | null>(null);
  const [isBatchTesting, setIsBatchTesting] = useState(false);
  const [batchTestProgress, setBatchTestProgress] = useState<{ done: number; total: number } | null>(null);
  const [testSymbol, setTestSymbol] = useState<Record<string, string>>({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<any>(null);
  const [editForm, setEditForm] = useState<EditFormData>({
    name: "",
    provider: "custom_api",
    apiEndpoint: "",
    apiKey: "",
    description: "",
  });

  // Queries
  const { data: healthData = [], refetch: refetchHealth } = trpc.health.sources.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: aiStatus, refetch: refetchAI } = trpc.health.geminiStatus.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: customSources = [], refetch: refetchCustom } = trpc.datasource.getConfigs.useQuery();

  // Mutations
  const testMutation = trpc.health.testSource.useMutation();
  const createMutation = trpc.datasource.createConfig.useMutation();
  const updateMutation = trpc.datasource.updateConfig.useMutation();
  const deleteMutation = trpc.datasource.deleteConfig.useMutation();

  // Build health map from DB
  const healthMap = useMemo(() => {
    const map: Record<string, typeof healthData[0]> = {};
    for (const h of healthData) {
      map[h.source] = h;
    }
    return map;
  }, [healthData]);

  // Stats
  const totalSources = BUILTIN_SOURCES.length + customSources.length;
  const normalCount = BUILTIN_SOURCES.filter(s => {
    const h = healthMap[s.id];
    return h && (h.successCount ?? 0) > 0 && ((h.failCount ?? 0) === 0 || (h.successCount ?? 0) > (h.failCount ?? 0));
  }).length;
  const totalSuccess = healthData.reduce((sum, h) => sum + (h.successCount ?? 0), 0);
  const totalFail = healthData.reduce((sum, h) => sum + (h.failCount ?? 0), 0);

  const getSourceStatus = (sourceId: string) => {
    const h = healthMap[sourceId];
    if (!h) return "unknown";
    if ((h.failCount ?? 0) > 0 && (h.successCount ?? 0) === 0) return "error";
    if ((h.failCount ?? 0) > 0 && (h.successCount ?? 0) > 0) return "degraded";
    if ((h.successCount ?? 0) > 0) return "ok";
    return "unknown";
  };

  const handleTest = async (sourceId: string) => {
    const symbol = testSymbol[sourceId] || "AAPL";
    setTestingSource(sourceId);
    try {
      const result = await testMutation.mutateAsync({
        source: sourceId as BuiltinSourceId,
        symbols: [symbol],
      });
      if (result.success) {
        toast.success(`${sourceId} 测试成功 · ${result.candleCount} 条数据 · ${result.latency}ms`);
      } else {
        toast.error(`${sourceId} 测试失败: ${result.error || "无数据"}`);
      }
      refetchHealth();
    } catch (err: any) {
      toast.error(`测试出错: ${err.message}`);
    } finally {
      setTestingSource(null);
    }
  };

  const handleTestAll = async () => {
    if (isBatchTesting) return;
    setIsBatchTesting(true);
    const allSources = BUILTIN_SOURCES.map(s => s.id);
    setBatchTestProgress({ done: 0, total: allSources.length });
    let successCount = 0, failCount = 0;
    for (let i = 0; i < allSources.length; i++) {
      const sourceId = allSources[i];
      const symbol = testSymbol[sourceId] || "AAPL";
      try {
        const result = await testMutation.mutateAsync({
          source: sourceId as BuiltinSourceId,
          symbols: [symbol],
        });
        if (result.success) successCount++; else failCount++;
      } catch { failCount++; }
      setBatchTestProgress({ done: i + 1, total: allSources.length });
    }
    await refetchHealth();
    setIsBatchTesting(false);
    setBatchTestProgress(null);
    toast.success(`批量测试完成: ${successCount} 成功, ${failCount} 失败`);
  };

  const handleEditBuiltin = (source: typeof BUILTIN_SOURCES[number]) => {
    setEditingSource({ ...source, isBuiltin: true });
    setEditForm({
      name: source.name,
      provider: source.id,
      apiEndpoint: "",
      apiKey: "",
      description: source.desc,
    });
    setEditDialogOpen(true);
  };

  const handleEditCustom = (source: any) => {
    setEditingSource({ ...source, isBuiltin: false });
    setEditForm({
      name: source.name,
      provider: source.provider,
      apiEndpoint: source.apiEndpoint || "",
      apiKey: source.apiKey || "",
      description: source.description || "",
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingSource) return;
    try {
      if (editingSource.isBuiltin) {
        toast.info("内置数据源的 API 密钥请通过环境变量配置");
        setEditDialogOpen(false);
        return;
      }
      await updateMutation.mutateAsync({
        sourceId: editingSource.id,
        ...editForm,
      });
      toast.success("数据源已更新");
      setEditDialogOpen(false);
      refetchCustom();
    } catch (err: any) {
      toast.error(err.message || "更新失败");
    }
  };

  const handleDeleteCustom = async (sourceId: number) => {
    if (!confirm("确定要删除这个数据源吗？")) return;
    try {
      await deleteMutation.mutateAsync({ sourceId });
      toast.success("数据源已删除");
      refetchCustom();
    } catch (err: any) {
      toast.error(err.message || "删除失败");
    }
  };

  const handleAddSource = async () => {
    if (!editForm.name || !editForm.provider) {
      toast.error("请填写数据源名称和提供商类型");
      return;
    }
    try {
      await createMutation.mutateAsync(editForm);
      toast.success("数据源已添加");
      setAddDialogOpen(false);
      setEditForm({ name: "", provider: "custom_api", apiEndpoint: "", apiKey: "", description: "" });
      refetchCustom();
    } catch (err: any) {
      toast.error(err.message || "添加失败");
    }
  };

  const handleRefreshAll = async () => {
    await Promise.all([refetchHealth(), refetchAI(), refetchCustom()]);
    toast.success("状态已刷新");
  };

  const statusBadge = (status: string) => {
    if (status === "ok") return <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-xs">正常</Badge>;
    if (status === "degraded") return <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 text-xs">降级</Badge>;
    if (status === "error") return <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-xs">异常</Badge>;
    return <Badge className="bg-gray-600/20 text-gray-400 border-gray-600/30 text-xs">未知</Badge>;
  };

  const statusIcon = (status: string) => {
    if (status === "ok") return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (status === "degraded") return <AlertCircle className="w-4 h-4 text-yellow-400" />;
    if (status === "error") return <XCircle className="w-4 h-4 text-red-400" />;
    return <Database className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">数据源健康监控</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={handleTestAll}
            disabled={isBatchTesting}
            className="gap-2"
          >
            {isBatchTesting ? (
              <><RefreshCw className="w-4 h-4 animate-spin" />
                {batchTestProgress ? `测试中 ${batchTestProgress.done}/${batchTestProgress.total}` : '测试中...'}
              </>
            ) : (
              <><Activity className="w-4 h-4" />一键全部测试</>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefreshAll} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            刷新
          </Button>
        </div>
      </div>

      {/* AI Service Status */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-sm text-foreground">AI 服务状态</span>
          </div>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1">
            <Plus className="w-3 h-3" />
            添加 AI
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          系统优先使用同配置 AI 配置，若下行可同时启动多组服务器服务，确保 AI 分析功能始终可用。
        </p>
        <div className="flex items-center gap-6 text-sm">
          {aiStatus ? (
            <>
              <div className="flex items-center gap-2">
                {aiStatus.gemini.connected
                  ? <CheckCircle className="w-4 h-4 text-green-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />}
                <span className="text-muted-foreground">Gemini</span>
                <span className={aiStatus.gemini.connected ? "text-green-400" : "text-red-400"}>
                  {aiStatus.gemini.connected ? "已连接" : "未连接"}
                </span>
                {aiStatus.gemini.model && (
                  <span className="text-xs text-muted-foreground">· {aiStatus.gemini.model}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {aiStatus.openai.connected
                  ? <CheckCircle className="w-4 h-4 text-green-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />}
                <span className="text-muted-foreground">OpenAI</span>
                <span className={aiStatus.openai.connected ? "text-green-400" : "text-red-400"}>
                  {aiStatus.openai.connected ? "已连接" : "未连接"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                活跃: <span className="text-foreground font-medium">
                  {aiStatus.activeProvider === "gemini" ? "Gemini" :
                   aiStatus.activeProvider === "openai" ? "OpenAI" : "无"}
                </span>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground text-xs flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />检测中...
            </span>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">{totalSources}</div>
            <div className="text-xs text-muted-foreground mt-1">数据源总数</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-400">{normalCount}</div>
            <div className="text-xs text-muted-foreground mt-1">正常数量</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-400">{totalSuccess.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">成功采集次数</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-400">{totalFail.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">失败采集次数</div>
          </CardContent>
        </Card>
      </div>

      {/* Data Sources Section */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Database className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-sm text-foreground">数据源状态</span>
            <span className="text-xs text-muted-foreground">· 输入股票代码并单击「测试」可实时验证数据源可用性</span>
          </div>
          <Button
            size="sm"
            className="gap-1 text-xs shrink-0"
            onClick={() => {
              setEditForm({ name: "", provider: "custom_api", apiEndpoint: "", apiKey: "", description: "" });
              setAddDialogOpen(true);
            }}
          >
            <Plus className="w-3 h-3" />
            添加数据源
          </Button>
        </div>

        {/* Built-in sources grid */}
        <div className="grid grid-cols-3 gap-3">
          {[...BUILTIN_SOURCES].sort((a, b) => a.priority - b.priority).map((source) => {
            const status = getSourceStatus(source.id);
            const h = healthMap[source.id];
            const isTesting = testingSource === source.id;
            const sym = testSymbol[source.id] !== undefined ? testSymbol[source.id] : "AAPL";

            return (
              <div
                key={source.id}
                className="border border-border rounded-lg p-3 bg-background hover:bg-muted/20 transition-colors"
              >
                {/* Source header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {statusIcon(status)}
                    <span className="font-semibold text-sm text-foreground">{source.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {statusBadge(status)}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => handleEditBuiltin(source)}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                      onClick={() => {
                        if (confirm(`确定要重置 ${source.name} 的统计数据吗？`)) {
                          deleteMutation.mutateAsync({ sourceId: 0, sourceName: source.id })
                            .then(() => { toast.success("已重置"); refetchHealth(); })
                            .catch((e: any) => toast.error(e.message));
                        }
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground mb-2">{source.desc}</p>

                {/* Stats row */}
                <div className="flex gap-4 text-xs mb-1">
                  <div>
                    <span className="text-muted-foreground">类型: </span>
                    <span className="text-foreground">{source.type}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">限速: </span>
                    <span className="text-foreground">{source.rateLimit}</span>
                  </div>
                </div>
                <div className="flex gap-4 text-xs mb-2">
                  <div>
                    <span className="text-muted-foreground">成功: </span>
                    <span className="text-green-400">{h?.successCount ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">失败: </span>
                    <span className="text-red-400">{h?.failCount ?? 0}</span>
                  </div>
                </div>

                {/* Last error */}
                {h?.lastError && (
                  <div className="mb-2">
                    <span className="text-xs text-muted-foreground">最近错误: </span>
                    <span className="text-xs text-red-400 break-all">{h.lastError.slice(0, 60)}</span>
                  </div>
                )}

                {/* Test row */}
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                  <Input
                    value={sym}
                    onChange={(e) => setTestSymbol(prev => ({ ...prev, [source.id]: e.target.value.toUpperCase() }))}
                    placeholder="AAPL"
                    className="h-6 text-xs px-2 w-20 bg-muted/50 border-border"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground px-2"
                    onClick={() => handleTest(source.id)}
                    disabled={isTesting}
                  >
                    {isTesting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    测试
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom sources */}
        {customSources.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-muted-foreground mb-2 font-medium border-t border-border pt-3">自定义数据源</div>
            <div className="grid grid-cols-3 gap-3">
              {customSources.map((source: any) => (
                <div key={source.id} className="border border-border rounded-lg p-3 bg-background">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-purple-400" />
                      <span className="font-semibold text-sm text-foreground">{source.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge className="bg-purple-600/20 text-purple-400 border-purple-600/30 text-xs">自定义</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditCustom(source)}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => handleDeleteCustom(source.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {source.description && (
                    <p className="text-xs text-muted-foreground mb-1">{source.description}</p>
                  )}
                  <div className="text-xs text-muted-foreground">
                    <span>类型: {source.provider}</span>
                    {source.apiEndpoint && (
                      <span className="ml-3">端点: {source.apiEndpoint.slice(0, 30)}{source.apiEndpoint.length > 30 ? "..." : ""}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Priority info footer */}
      <div className="border border-border rounded-lg p-4 bg-card text-xs text-muted-foreground space-y-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-3 h-3 mt-0.5 text-yellow-400 shrink-0" />
          <div>
            <span className="text-yellow-400 font-medium">数据源优先级: </span>
            Alpaca (最优) → Tiingo → Finnhub → AlphaVantage → Polygon → TwelveData → Stooq → Yahoo → MarketStack
          </div>
        </div>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-3 h-3 mt-0.5 text-blue-400 shrink-0" />
          <div>
            <span className="text-blue-400 font-medium">手动测试说明: </span>
            每个数据源卡片可以输入股票代码（默认 AAPL）并点击「测试」按钮，实时验证该数据源是否可用。
          </div>
        </div>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-3 h-3 mt-0.5 text-gray-400 shrink-0" />
          <div>
            <span className="text-gray-400 font-medium">免费说明: </span>
            Polygon/TwelveData/MarketStack 为部分免费数据源，每月/每天/每分钟有调用额度限制，建议优先使用 Alpaca/Tiingo/Finnhub。
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>
              {editingSource?.isBuiltin ? `编辑内置数据源: ${editingSource?.name}` : "编辑自定义数据源"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editingSource?.isBuiltin ? (
              <div className="p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
                内置数据源的 API 密钥通过环境变量配置（如 ALPACA_API_KEY、TIINGO_API_KEY 等），无法在此页面修改。
                请通过「设置 → 密钥管理」更新环境变量后重启服务。
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">数据源名称</label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">提供商类型</label>
                  <select
                    value={editForm.provider}
                    onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })}
                    className="w-full mt-1 px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                  >
                    <option value="custom_api">自定义 API</option>
                    <option value="csv_upload">CSV 上传</option>
                    <option value="database">数据库连接</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">API 端点</label>
                  <Input
                    value={editForm.apiEndpoint}
                    onChange={(e) => setEditForm({ ...editForm, apiEndpoint: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">API 密钥</label>
                  <Input
                    type="password"
                    value={editForm.apiKey}
                    onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                    placeholder="输入 API 密钥"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">描述</label>
                  <Input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="数据源说明"
                    className="mt-1"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editingSource?.isBuiltin ? "知道了" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>添加自定义数据源</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">数据源名称 *</label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="例如：我的自定义源"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">提供商类型 *</label>
              <select
                value={editForm.provider}
                onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              >
                <option value="custom_api">自定义 API</option>
                <option value="csv_upload">CSV 上传</option>
                <option value="database">数据库连接</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">API 端点</label>
              <Input
                value={editForm.apiEndpoint}
                onChange={(e) => setEditForm({ ...editForm, apiEndpoint: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">API 密钥</label>
              <Input
                type="password"
                value={editForm.apiKey}
                onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                placeholder="输入 API 密钥"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="数据源说明"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleAddSource}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
