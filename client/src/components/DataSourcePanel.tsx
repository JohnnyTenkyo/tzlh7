import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, Edit2, Plus } from "lucide-react";

export function DataSourcePanel() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    provider: "custom_api",
    apiEndpoint: "",
    apiKey: "",
    description: "",
  });

  const { data: sources = [], refetch } = trpc.datasource.getConfigs.useQuery();
  const createMutation = trpc.datasource.createConfig.useMutation();
  const updateMutation = trpc.datasource.updateConfig.useMutation();
  const deleteMutation = trpc.datasource.deleteConfig.useMutation();

  const handleAddClick = () => {
    setEditingId(null);
    setFormData({
      name: "",
      provider: "custom_api",
      apiEndpoint: "",
      apiKey: "",
      description: "",
    });
    setIsFormOpen(true);
  };

  const handleEditClick = (source: any) => {
    setEditingId(source.id);
    setFormData({
      name: source.name,
      provider: source.provider,
      apiEndpoint: source.apiEndpoint || "",
      apiKey: source.apiKey || "",
      description: source.description || "",
    });
    setIsFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.provider) {
      toast.error("请填写必填项");
      return;
    }

    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          sourceId: editingId,
          ...formData,
        });
        toast.success("数据源已更新");
      } else {
        await createMutation.mutateAsync(formData);
        toast.success("数据源已添加");
      }
      setIsFormOpen(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "操作失败");
    }
  };

  const handleDelete = async (sourceId: number) => {
    if (!confirm("确定要删除这个数据源吗？")) return;

    try {
      await deleteMutation.mutateAsync({ sourceId });
      toast.success("数据源已删除");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "删除失败");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">数据源配置</h3>
        <Button onClick={handleAddClick} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          添加数据源
        </Button>
      </div>

      {isFormOpen && (
        <Card className="bg-muted/50 border-border">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">数据源名称 *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：我的自定义源"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium">提供商类型 *</label>
                <select
                  value={formData.provider}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="custom_api">自定义 API</option>
                  <option value="csv_upload">CSV 上传</option>
                  <option value="database">数据库连接</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">API 端点</label>
                <Input
                  value={formData.apiEndpoint}
                  onChange={(e) => setFormData({ ...formData, apiEndpoint: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium">API 密钥</label>
                <Input
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="输入 API 密钥"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium">描述</label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="数据源说明"
                  className="mt-1"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setIsFormOpen(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editingId ? "更新" : "添加"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {sources.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            暂无数据源配置
          </div>
        ) : (
          sources.map((source: any) => (
            <Card key={source.id} className="border-border">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold">{source.name}</h4>
                      <Badge variant="outline">{source.provider}</Badge>
                      {source.isActive && <Badge variant="default">活跃</Badge>}
                    </div>
                    {source.description && (
                      <p className="text-sm text-muted-foreground mb-2">{source.description}</p>
                    )}
                    {source.apiEndpoint && (
                      <p className="text-xs text-muted-foreground">
                        端点: {source.apiEndpoint}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditClick(source)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(source.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
