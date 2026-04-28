import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical, RotateCcw, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const DATA_SOURCES = [
  { id: "eodhd", label: "EODHD", color: "bg-blue-500/20 border-blue-500/50" },
  { id: "tiingo", label: "Tiingo", color: "bg-green-500/20 border-green-500/50" },
  { id: "finnhub", label: "Finnhub", color: "bg-purple-500/20 border-purple-500/50" },
  { id: "alphavantage", label: "Alpha Vantage", color: "bg-orange-500/20 border-orange-500/50" },
  { id: "polygon", label: "Polygon", color: "bg-pink-500/20 border-pink-500/50" },
  { id: "twelvedata", label: "Twelve Data", color: "bg-cyan-500/20 border-cyan-500/50" },
  { id: "stooq", label: "Stooq", color: "bg-yellow-500/20 border-yellow-500/50" },
  { id: "yahoo", label: "Yahoo Finance", color: "bg-indigo-500/20 border-indigo-500/50" },
  { id: "marketstack", label: "MarketStack", color: "bg-red-500/20 border-red-500/50" },
];

export function DataSourcePriorityReorder() {
  const [order, setOrder] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: priorityData, isLoading } = trpc.dataSourcePriority.getPriority.useQuery();
  const updateMutation = trpc.dataSourcePriority.updatePriority.useMutation({
    onSuccess: () => {
      toast.success("数据源优先级已更新");
      utils.dataSourcePriority.getPriority.invalidate();
    },
    onError: (e) => toast.error(`更新失败: ${e.message}`),
  });
  const resetMutation = trpc.dataSourcePriority.resetToDefault.useMutation({
    onSuccess: () => {
      toast.success("已恢复默认优先级");
      utils.dataSourcePriority.getPriority.invalidate();
    },
    onError: (e) => toast.error(`恢复失败: ${e.message}`),
  });

  useEffect(() => {
    if (priorityData?.sourceOrder) {
      setOrder(priorityData.sourceOrder);
    }
  }, [priorityData]);

  const handleDragStart = (index: number) => {
    setIsDragging(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (isDragging === null || isDragging === index) return;

    const newOrder = [...order];
    const draggedItem = newOrder[isDragging];
    newOrder.splice(isDragging, 1);
    newOrder.splice(index, 0, draggedItem);
    setOrder(newOrder);
    setIsDragging(index);
  };

  const handleDragEnd = () => {
    setIsDragging(null);
  };

  const getSourceLabel = (id: string) => {
    return DATA_SOURCES.find(s => s.id === id)?.label || id;
  };

  const getSourceColor = (id: string) => {
    return DATA_SOURCES.find(s => s.id === id)?.color || "bg-gray-500/20";
  };

  if (isLoading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-sm font-medium">数据源优先级</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">拖拽调整数据源优先级（上面的优先级更高）</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Draggable list */}
        <div className="space-y-2 bg-muted/20 rounded p-3">
          {order.map((sourceId, index) => (
            <div
              key={sourceId}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 p-2 rounded cursor-move transition-all ${
                isDragging === index
                  ? "bg-primary/20 border border-primary/50 opacity-75"
                  : "hover:bg-muted/50 border border-transparent"
              }`}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Badge className={`${getSourceColor(sourceId)} border`}>
                {getSourceLabel(sourceId)}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">#{index + 1}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => updateMutation.mutate({ sourceOrder: order })}
            disabled={updateMutation.isPending}
            className="flex-1"
          >
            <Save className="h-4 w-4 mr-2" />
            保存优先级
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="flex-1"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            恢复默认
          </Button>
        </div>

        {/* Info */}
        <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
          <p>💡 当前优先级：{order.join(" → ")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
