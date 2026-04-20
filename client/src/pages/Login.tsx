import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="min-h-screen flex">
      {/* 左侧品牌区 */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] bg-gradient-to-br from-[oklch(0.55_0.22_250)] via-[oklch(0.50_0.20_245)] to-[oklch(0.42_0.18_255)] p-12 relative overflow-hidden">
        {/* 装饰圆 */}
        <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-[oklch(0.72_0.16_200)]/15 blur-3xl" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <BarChart3 size={18} className="text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-wide">西山居报表查询系统</span>
        </div>

        {/* 中央文案 */}
        <div className="relative z-10">
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            企业级<br />数据报表<br />管理平台
          </h2>
          <p className="text-white/70 text-base leading-relaxed">
            实时查询封装厂 WIP 数据、委外订单状态，<br />
            支持多维度筛选与 Excel 导出。
          </p>
          {/* 特性标签 */}
          <div className="flex flex-wrap gap-2 mt-8">
            {["WIP 汇总", "委外订单", "数据导出", "权限管理"].map(tag => (
              <span key={tag} className="px-3 py-1 rounded-full bg-white/15 text-white/90 text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* 底部版权 */}
        <p className="relative z-10 text-white/35 text-xs">
          © {new Date().getFullYear()} 西山居报表查询系统 · 企业内部使用
        </p>
      </div>

      {/* 右侧登录区 */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[oklch(0.97_0.01_250)] px-6 py-12">
        {/* 移动端 Logo */}
        <div className="lg:hidden flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[oklch(0.50_0.20_245)] flex items-center justify-center shadow-lg mb-3">
            <BarChart3 size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-[oklch(0.25_0.10_250)]">西山居报表查询系统</h1>
        </div>

        <div className="w-full max-w-sm">
          {/* 标题 */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[oklch(0.22_0.08_250)]">欢迎回来</h2>
            <p className="text-[oklch(0.50_0.06_250)] text-sm mt-1">请登录您的账号以继续</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 错误提示 */}
            {errorMsg && (
              <Alert className="bg-red-50 border-red-200 text-red-700">
                <AlertCircle size={14} className="text-red-500" />
                <AlertDescription className="text-red-600 text-sm">{errorMsg}</AlertDescription>
              </Alert>
            )}

            {/* 用户名 */}
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-[oklch(0.30_0.08_250)] text-sm font-medium">
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
                className="h-11 bg-white border-[oklch(0.82_0.06_250)] text-[oklch(0.20_0.08_250)] placeholder:text-[oklch(0.70_0.04_250)] focus:border-[oklch(0.50_0.20_245)] focus:ring-2 focus:ring-[oklch(0.50_0.20_245)]/20 rounded-lg"
              />
            </div>

            {/* 密码 */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[oklch(0.30_0.08_250)] text-sm font-medium">
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
                  className="h-11 bg-white border-[oklch(0.82_0.06_250)] text-[oklch(0.20_0.08_250)] placeholder:text-[oklch(0.70_0.04_250)] focus:border-[oklch(0.50_0.20_245)] focus:ring-2 focus:ring-[oklch(0.50_0.20_245)]/20 rounded-lg pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[oklch(0.60_0.06_250)] hover:text-[oklch(0.40_0.10_250)] transition-colors"
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
              className="w-full h-11 bg-[oklch(0.50_0.20_245)] hover:bg-[oklch(0.45_0.20_245)] text-white font-semibold text-sm rounded-lg shadow-md shadow-[oklch(0.50_0.20_245)]/30 transition-all mt-2"
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

          <p className="text-center text-[oklch(0.65_0.05_250)] text-xs mt-8">
            © {new Date().getFullYear()} 西山居报表查询系统 · 企业内部使用
          </p>
        </div>
      </div>
    </div>
  );
}
