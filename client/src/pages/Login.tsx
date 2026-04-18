import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BarChart3, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      // 刷新 auth.me 缓存后跳转首页
      await utils.auth.me.invalidate();
      navigate("/");
    },
    onError: (err) => {
      setErrorMsg(err.message || "登录失败，请检查用户名和密码");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    if (!username.trim()) {
      setErrorMsg("请输入用户名");
      return;
    }
    if (!password) {
      setErrorMsg("请输入密码");
      return;
    }
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[oklch(0.18_0.04_250)] via-[oklch(0.22_0.05_240)] to-[oklch(0.16_0.04_260)] flex items-center justify-center p-4">
      {/* 右上角版本信息 */}
      <div className="absolute top-4 right-5 text-white/30 text-xs font-mono select-none">
        v1.0.0
      </div>
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-[oklch(0.72_0.16_75)]/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-[oklch(0.55_0.15_250)]/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo 区域 */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[oklch(0.72_0.16_75)] flex items-center justify-center shadow-lg shadow-[oklch(0.72_0.16_75)]/30 mb-4">
            <BarChart3 size={28} className="text-[oklch(0.15_0.05_75)]" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">报表查询系统</h1>
          <p className="text-white/50 text-sm mt-1">企业级数据报表管理平台</p>
        </div>

        {/* 登录卡片 */}
        <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-lg font-semibold">用户登录</CardTitle>
            <CardDescription className="text-white/50 text-sm">
              请输入您的账号和密码
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 错误提示 */}
              {errorMsg && (
                <Alert variant="destructive" className="bg-red-500/10 border-red-500/30 text-red-300">
                  <AlertCircle size={14} className="text-red-400" />
                  <AlertDescription className="text-red-300 text-sm">{errorMsg}</AlertDescription>
                </Alert>
              )}

              {/* 用户名 */}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-white/80 text-sm font-medium">
                  用户名
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  disabled={loginMutation.isPending}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-[oklch(0.72_0.16_75)] focus:ring-[oklch(0.72_0.16_75)]/20 h-11"
                />
              </div>

              {/* 密码 */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-white/80 text-sm font-medium">
                  密码
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={loginMutation.isPending}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-[oklch(0.72_0.16_75)] focus:ring-[oklch(0.72_0.16_75)]/20 h-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* 登录按钮 */}
              <Button
                type="submit"
                disabled={loginMutation.isPending}
                className="w-full h-11 bg-[oklch(0.72_0.16_75)] hover:bg-[oklch(0.68_0.16_75)] text-[oklch(0.15_0.05_75)] font-semibold text-sm shadow-lg shadow-[oklch(0.72_0.16_75)]/20 transition-all"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    登录中...
                  </>
                ) : (
                  "登 录"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 底部版权 */}
        <p className="text-center text-white/25 text-xs mt-6">
          © {new Date().getFullYear()} 报表查询系统 · 企业内部使用
        </p>
      </div>
    </div>
  );
}
