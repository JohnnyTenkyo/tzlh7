import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings, Bot, Database, Plus, Trash2, CheckCircle, Star, ArrowUpDown, Clock, Play, Square } from "lucide-react";
import { DataSourcePriorityReorder } from "@/components/DataSourcePriorityReorder";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export default function SettingsPage() {
  const { user } = useAuth();
  const { data: aiConfigs, refetch: refetchAI } = trpc.ai.getConfigs.useQuery();

  // Scheduled cache warming
  const { data: scheduledTasks, refetch: refetchTasks } = trpc.cache.listScheduledTasks.useQuery();
  const [newTaskName, setNewTaskName] = useState("每日自动预热");
  const [newTaskCron, setNewTaskCron] = useState("0 0 9 * * 1-5");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const CRON_PRESETS = [
    { label: "工作日 9:00 AM", value: "0 0 9 * * 1-5" },
    { label: "工作日 8:30 AM", value: "0 30 8 * * 1-5" },
    { label: "每天 9:00 AM", value: "0 0 9 * * *" },
    { label: "每天 7:00 AM", value: "0 0 7 * * *" },
  ];
  const createTask = trpc.cache.createScheduledTask.useMutation({
    onSuccess: () => { refetchTasks(); toast.success("定时任务已创建"); setShowTaskForm(false); },
    onError: (e) => toast.error("创建失败: " + e.message),
  });
  const updateTask = trpc.cache.updateScheduledTask.useMutation({
    onSuccess: () => { refetchTasks(); toast.success("已更新"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteTask = trpc.cache.deleteScheduledTask.useMutation({
    onSuccess: () => { refetchTasks(); toast.success("已删除"); },
    onError: (e) => toast.error(e.message),
  });
  const { data: customSources, refetch: refetchSources } = trpc.datasource.getConfigs.useQuery();

  const createAIConfig = trpc.ai.createConfig.useMutation({
    onSuccess: () => { toast.success("AI 配置已添加"); refetchAI(); setShowAIForm(false); },
    onError: (e) => toast.error(e.message),
  });
  const deleteAIConfig = trpc.ai.deleteConfig.useMutation({
    onSuccess: () => { toast.success("已删除"); refetchAI(); },
    onError: (e) => toast.error(e.message),
  });
  const setDefaultAI = trpc.ai.setDefault.useMutation({
    onSuccess: () => { toast.success("已设为默认"); refetchAI(); },
    onError: (e) => toast.error(e.message),
  });

  const [showAIForm, setShowAIForm] = useState(false);
  const [aiForm, setAIForm] = useState({ provider: "openai", apiEndpoint: "", apiKey: "", model: "" });

  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => { toast.success("密码已修改"); setPwForm({ old: "", new1: "", new2: "" }); },
    onError: (e) => toast.error(e.message),
  });
  const [pwForm, setPwForm] = useState({ old: "", new1: "", new2: "" });

  const handleChangePassword = () => {
    if (pwForm.new1 !== pwForm.new2) { toast.error("两次密码不一致"); return; }
    if (pwForm.new1.length < 6) { toast.error("密码至少 6 位"); return; }
    changePassword.mutate({ oldPassword: pwForm.old, newPassword: pwForm.new1 });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          系统设置
        </h1>
        <p className="text-muted-foreground text-sm mt-1">管理 AI 服务、数据源和账户设置</p>
      </div>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">账户设置</CardTitle>
          <CardDescription>修改登录密码</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold">
              {user?.name?.[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <p className="font-medium text-sm">{user?.name || "用户"}</p>
              <p className="text-xs text-muted-foreground">{user?.role === "admin" ? "管理员" : "普通用户"}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">当前密码</Label>
              <Input type="password" value={pwForm.old} onChange={e => setPwForm(p => ({ ...p, old: e.target.value }))} placeholder="当前密码" />
            </div>
            <div>
              <Label className="text-xs">新密码</Label>
              <Input type="password" value={pwForm.new1} onChange={e => setPwForm(p => ({ ...p, new1: e.target.value }))} placeholder="新密码（至少6位）" />
            </div>
            <div>
              <Label className="text-xs">确认新密码</Label>
              <Input type="password" value={pwForm.new2} onChange={e => setPwForm(p => ({ ...p, new2: e.target.value }))} placeholder="再次输入新密码" />
            </div>
          </div>
          <Button size="sm" onClick={handleChangePassword} disabled={changePassword.isPending}>
            {changePassword.isPending ? "修改中..." : "修改密码"}
          </Button>
        </CardContent>
      </Card>

      {/* AI Configs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="w-4 h-4" />
                AI 服务配置
              </CardTitle>
              <CardDescription>配置 Gemini / OpenAI 等 AI 服务</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAIForm(!showAIForm)}>
              <Plus className="w-4 h-4 mr-1" />
              添加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showAIForm && (
            <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">提供商</Label>
                  <Input value={aiForm.provider} onChange={e => setAIForm(p => ({ ...p, provider: e.target.value }))} placeholder="gemini / openai" />
                </div>
                <div>
                  <Label className="text-xs">模型</Label>
                  <Input value={aiForm.model} onChange={e => setAIForm(p => ({ ...p, model: e.target.value }))} placeholder="gemini-2.0-flash" />
                </div>
              </div>
              <div>
                <Label className="text-xs">API Endpoint</Label>
                <Input value={aiForm.apiEndpoint} onChange={e => setAIForm(p => ({ ...p, apiEndpoint: e.target.value }))} placeholder="https://..." />
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <Input type="password" value={aiForm.apiKey} onChange={e => setAIForm(p => ({ ...p, apiKey: e.target.value }))} placeholder="sk-..." />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => createAIConfig.mutate(aiForm)} disabled={createAIConfig.isPending}>
                  {createAIConfig.isPending ? "保存中..." : "保存"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAIForm(false)}>取消</Button>
              </div>
            </div>
          )}
          {!aiConfigs || aiConfigs.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无 AI 配置，请添加。</p>
          ) : (
            aiConfigs.map((cfg: any) => (
              <div key={cfg.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{cfg.provider}</p>
                    {cfg.isActive && <Badge variant="default" className="text-xs"><CheckCircle className="w-3 h-3 mr-1" />默认</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{cfg.model} · {cfg.apiEndpoint}</p>
                </div>
                <div className="flex gap-2">
                  {!cfg.isActive && (
                    <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setDefaultAI.mutate({ provider: cfg.provider, configId: cfg.id })}>
                      <Star className="w-3 h-3" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive" onClick={() => deleteAIConfig.mutate({ configId: cfg.id })}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Custom Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-4 h-4" />
            自定义数据源
          </CardTitle>
          <CardDescription>管理自定义市场数据源</CardDescription>
        </CardHeader>
        <CardContent>
          {!customSources || customSources.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无自定义数据源。</p>
          ) : (
            <div className="space-y-2">
              {customSources.map((src: any) => (
                <div key={src.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <p className="font-medium text-sm">{src.name}</p>
                    <p className="text-xs text-muted-foreground">{src.provider} · {src.apiEndpoint}</p>
                  </div>
                  <Badge variant={src.isActive ? "default" : "secondary"}>
                    {src.isActive ? "启用" : "禁用"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    {/* Data Source Priority */}
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowUpDown className="w-4 h-4" />
          数据源优先级
        </CardTitle>
        <CardDescription>拖拽调整缓存预热时数据源的优先顺序（上方优先级更高）</CardDescription>
      </CardHeader>
      <CardContent>
        <DataSourcePriorityReorder />
      </CardContent>
    </Card>

    {/* Scheduled Cache Warming */}
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4" />
              定时自动预热
            </CardTitle>
            <CardDescription>配置缓存预热的自动执行时间，无需手动点击</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowTaskForm(!showTaskForm)}>
            <Plus className="w-4 h-4 mr-1" />
            添加
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showTaskForm && (
          <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">任务名称</Label>
                <Input value={newTaskName} onChange={e => setNewTaskName(e.target.value)} placeholder="每日自动预热" />
              </div>
              <div>
                <Label className="text-xs">Cron 表达式（6字段）</Label>
                <Input value={newTaskCron} onChange={e => setNewTaskCron(e.target.value)} placeholder="0 0 9 * * 1-5" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground self-center">快速选择：</span>
              {CRON_PRESETS.map(p => (
                <Button key={p.value} size="sm" variant={newTaskCron === p.value ? "default" : "outline"}
                  className="text-xs h-7" onClick={() => setNewTaskCron(p.value)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">格式：秒 分 时 日 月 周（如 0 0 9 * * 1-5 表示周一至周五 9:00）</p>
            <div className="flex gap-2">
              <Button size="sm"
                onClick={() => createTask.mutate({ name: newTaskName, cronExpression: newTaskCron })}
                disabled={createTask.isPending || !newTaskName || !newTaskCron}>
                {createTask.isPending ? "创建中..." : "创建任务"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowTaskForm(false)}>取消</Button>
            </div>
          </div>
        )}
        {/* System built-in scheduled tasks */}
        <div className="space-y-2 mb-2">
          <p className="text-xs text-muted-foreground font-medium">系统内置任务（自动运行，无需配置）</p>
          {[
            { name: "每日全量扫描", desc: "美东时间 10:00 AM（开盘后30分钟）", cron: "0 0 14 * * 1-5 (UTC)", color: "bg-blue-500" },
            { name: "K线缓存预热", desc: "美东时间 05:00 AM（非交易时段）", cron: "0 0 9 * * 1-5 (UTC)", color: "bg-purple-500" },
          ].map(t => (
            <div key={t.name} className="p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${t.color}`} />
                <div className="flex-1">
                  <p className="font-medium text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                  <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">{t.cron}</p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">系统</Badge>
              </div>
            </div>
          ))}
        </div>
        {/* User custom tasks */}
        {!scheduledTasks || scheduledTasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无自定义定时任务，点击"添加"创建。</p>
        ) : (
          <div className="space-y-2">
            {scheduledTasks.map((task: any) => (
              <div key={task.id} className="p-3 rounded-lg border bg-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${task.isEnabled ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                    <div>
                      <p className="font-medium text-sm">{task.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{task.cronExpression}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="icon" variant="ghost" className="w-7 h-7"
                      onClick={() => updateTask.mutate({ taskId: task.id, isEnabled: !task.isEnabled })}>
                      {task.isEnabled ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive"
                      onClick={() => deleteTask.mutate({ taskId: task.id })}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {/* Last / Next execution times */}
                <div className="mt-2 ml-5 grid grid-cols-2 gap-x-4">
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground/60">上次执行：</span>
                    <span className={task.lastExecutedAt ? "text-green-400" : "text-muted-foreground/50"}>
                      {task.lastExecutedAt
                        ? new Date(task.lastExecutedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                        : "从未执行"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground/60">下次执行：</span>
                    <span className={task.nextExecutedAt && task.isEnabled ? "text-blue-400" : "text-muted-foreground/50"}>
                      {task.nextExecutedAt && task.isEnabled
                        ? new Date(task.nextExecutedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
