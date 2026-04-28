import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { TrendingUp } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "", name: "" });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("登录成功");
      setLocation("/");
      window.location.reload();
    },
    onError: (e) => toast.error(e.message),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("注册成功，已自动登录");
      setLocation("/");
      window.location.reload();
    },
    onError: (e) => toast.error(e.message),
  });

  if (user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-sm bg-card border-border">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="text-green-400 text-lg font-medium">已登录</div>
            <p className="text-muted-foreground text-sm">当前用户：{user.name || user.email}</p>
            <Button onClick={() => setLocation("/")} className="w-full">返回首页</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold">梯子量化平台</h1>
          </div>
          <p className="text-muted-foreground text-sm">登录后可使用回测功能和保存策略</p>
        </div>

        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-username">用户名</Label>
                  <Input
                    id="login-username"
                    placeholder="请输入用户名"
                    value={loginForm.username}
                    onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">密码</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="请输入密码"
                    value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                    className="bg-input border-border"
                    onKeyDown={e => e.key === "Enter" && loginMutation.mutate(loginForm)}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => loginMutation.mutate(loginForm)}
                  disabled={loginMutation.isPending || !loginForm.username || !loginForm.password}
                >
                  {loginMutation.isPending ? "登录中..." : "登录"}
                </Button>
              </TabsContent>

              <TabsContent value="register" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-username">用户名 *</Label>
                  <Input
                    id="reg-username"
                    placeholder="2-32个字符"
                    value={registerForm.username}
                    onChange={e => setRegisterForm(f => ({ ...f, username: e.target.value }))}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-name">昵称</Label>
                  <Input
                    id="reg-name"
                    placeholder="可选"
                    value={registerForm.name}
                    onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">密码 *</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="至少4个字符"
                    value={registerForm.password}
                    onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))}
                    className="bg-input border-border"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => registerMutation.mutate(registerForm)}
                  disabled={registerMutation.isPending || !registerForm.username || !registerForm.password}
                >
                  {registerMutation.isPending ? "注册中..." : "注册"}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
