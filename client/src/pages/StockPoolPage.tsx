import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Search, BookOpen, Star, Settings2 } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
export default function StockPoolPage() {
  const [search, setSearch] = useState("");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const PAGE_SIZE = 50;
  const [thresholdDialog, setThresholdDialog] = useState<{symbol: string; name: string; current: number} | null>(null);
  const [thresholdInput, setThresholdInput] = useState(80);

  const { data: watchlistData, refetch: refetchWatchlist } = trpc.watchlist.list.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const addMutation = trpc.watchlist.add.useMutation({ onSuccess: () => { refetchWatchlist(); toast.success('已加入自选'); }, onError: (e) => toast.error(e.message) });
  const removeMutation = trpc.watchlist.remove.useMutation({ onSuccess: () => { refetchWatchlist(); toast.success('已移出自选'); }, onError: (e) => toast.error(e.message) });
  const updateThresholdMutation = trpc.watchlist.updateThreshold.useMutation({ onSuccess: () => { refetchWatchlist(); toast.success('阈值已更新'); setThresholdDialog(null); }, onError: (e) => toast.error(e.message) });
  const watchlistMap = useMemo(() => {
    const m = new Map<string, number>();
    (watchlistData || []).forEach((w: any) => m.set(w.symbol, w.alertThreshold ?? 80));
    return m;
  }, [watchlistData]);
  const watchlistSymbols = useMemo(() => new Set(watchlistMap.keys()), [watchlistMap]);

  const handleToggleWatchlist = (symbol: string, name: string) => {
    if (!isAuthenticated) { toast.error('请先登录'); return; }
    if (watchlistSymbols.has(symbol)) {
      removeMutation.mutate({ symbol });
    } else {
      addMutation.mutate({ symbol, name });
    }
  };

  const handleOpenThreshold = (symbol: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) { toast.error('请先登录'); return; }
    const current = watchlistMap.get(symbol) ?? 80;
    setThresholdInput(current);
    setThresholdDialog({ symbol, name, current });
  };

  const { data: sectorsData } = trpc.stockPool.sectors.useQuery();
  const { data, isLoading } = trpc.stockPool.list.useQuery({
    search: search || undefined,
    sector: selectedSector || undefined,
    page,
    pageSize: PAGE_SIZE,
  }, { keepPreviousData: true } as any);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleSector = (s: string | null) => {
    setSelectedSector(s);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">股票池</h1>
        <span className="text-sm text-muted-foreground">共 {data?.total || 0} 只股票</span>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索股票代码或名称..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="pl-9 bg-input border-border"
        />
      </div>

      {/* Sectors */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleSector(null)}
          className={`px-3 py-1 rounded-full text-xs border transition-colors ${
            !selectedSector
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground border-border hover:border-primary/50"
          }`}
        >
          全部
        </button>
        {sectorsData?.map(s => (
          <button
            key={s.name}
            onClick={() => handleSector(s.name)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              selectedSector === s.name
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {s.name} <span className="opacity-60">({s.count})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="text-left py-3 px-4">代码</th>
                    <th className="text-left py-3 px-4">名称</th>
                    <th className="text-left py-3 px-4">行业</th>
                    <th className="text-right py-3 px-4">市值</th>
                    <th className="text-right py-3 px-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map(stock => (
                    <tr key={stock.symbol} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-4">
                        <span className="font-mono font-medium text-primary">{stock.symbol}</span>
                      </td>
                      <td className="py-2 px-4 text-foreground">{stock.name}</td>
                      <td className="py-2 px-4">
                        <div className="flex flex-wrap gap-1">
                          {stock.sectors.slice(0, 2).map(s => (
                            <Badge
                              key={s}
                              variant="secondary"
                              className="text-xs h-4 cursor-pointer hover:bg-primary/20"
                              onClick={() => handleSector(s)}
                            >
                              {s}
                            </Badge>
                          ))}
                          {stock.sectors.length > 2 && (
                            <span className="text-xs text-muted-foreground">+{stock.sectors.length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-4 text-right text-muted-foreground text-xs">
                        {stock.marketCap > 0
                          ? stock.marketCap >= 1e12
                            ? `$${(stock.marketCap / 1e12).toFixed(1)}T`
                            : stock.marketCap >= 1e9
                            ? `$${(stock.marketCap / 1e9).toFixed(1)}B`
                            : `$${(stock.marketCap / 1e6).toFixed(0)}M`
                          : "-"}
                      </td>
                      <td className="py-2 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 w-6 p-0 ${watchlistSymbols.has(stock.symbol) ? 'text-yellow-400 hover:text-yellow-500' : 'text-muted-foreground hover:text-yellow-400'}`}
                            onClick={(e) => { e.stopPropagation(); handleToggleWatchlist(stock.symbol, stock.name); }}
                            title={watchlistSymbols.has(stock.symbol) ? '移出自选' : '加入自选'}
                          >
                            {watchlistSymbols.has(stock.symbol) ? <Star className="h-3.5 w-3.5 fill-current" /> : <Star className="h-3.5 w-3.5" />}
                          </Button>
                          {watchlistSymbols.has(stock.symbol) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                              onClick={(e) => handleOpenThreshold(stock.symbol, stock.name, e)}
                              title="设置预警阈值"
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            第 {(page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, data.total)} 条，共 {data.total} 条
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * PAGE_SIZE >= data.total}
              onClick={() => setPage(p => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
      {/* Threshold Dialog */}
      {thresholdDialog && (
        <Dialog open={!!thresholdDialog} onOpenChange={(open) => !open && setThresholdDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>设置预警阈值 - {thresholdDialog.symbol}</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-3">
              <Label className="text-sm">当扫描分数超过此阈值时标红提醒</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">分（0-100）</span>
              </div>
              <p className="text-xs text-muted-foreground">当前阈值: {thresholdDialog.current} 分</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setThresholdDialog(null)}>取消</Button>
              <Button
                onClick={() => updateThresholdMutation.mutate({ symbol: thresholdDialog.symbol, alertThreshold: thresholdInput })}
                disabled={updateThresholdMutation.isPending}
              >确认</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
