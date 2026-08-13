import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { BarChart3, Clock } from "lucide-react";
import { Link } from "wouter";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import WipDailyStatusPanel from "@/components/WipDailyStatusPanel";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export default function Home() {
  const { user } = useAuth();
  const { data: modules, isLoading } = trpc.reportModules.list.useQuery();

  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日${WEEKDAYS[now.getDay()]}`;

  return (
    <div className="h-full flex flex-col p-6 gap-6">
      {/* 欢迎横幅 */}
      {/*
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[oklch(0.32_0.14_252)] via-[oklch(0.28_0.12_255)] to-[oklch(0.22_0.10_260)] px-8 py-5 shadow-lg flex-shrink-0">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-white mb-1">
              你好，{user?.name || "用户"} 👋
            </h1>
            <div className="flex items-center gap-2 text-[oklch(0.72_0.16_75)] text-sm flex-shrink-0">
              <Clock size={14} />
              <span>{dateStr}</span>
            </div>
          </div>
          <p className="text-white/70 text-sm">欢迎使用昂宝集成电路报表查询系统，以下是您可访问的报表模块</p>
        </div>
        <div className="absolute right-0 top-0 w-64 h-64 rounded-full bg-white/5 -translate-y-1/3 translate-x-1/4" />
        <div className="absolute right-16 bottom-0 w-32 h-32 rounded-full bg-white/5 translate-y-1/2" />
      </div>
      */}

      {/* WIP 日报接收状态看板 */}
      <WipDailyStatusPanel />

      {/* 报表模块分组：flex-1 占满剩余空间 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          </div>
        ) : modules && modules.length > 0 ? (
          (() => {
            const grouped = modules.reduce((acc, m) => {
              const cat = m.category || "其他";
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(m);
              return acc;
            }, {} as Record<string, typeof modules>);

            return Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 size={16} className="text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">{category}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {items.map((module) => (
                    <Link key={module.id} href={module.route || "#"}>
                      <Card
                        className="group h-full py-4 gap-2 hover:shadow-md transition-all duration-200 border-border hover:border-primary/30 cursor-pointer"
                      >
                        <CardHeader className="px-4">
                          <div className="flex items-start justify-between">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                              <BarChart3 size={15} className="text-primary" />
                            </div>
                            <Badge variant="secondary" className="text-xs bg-green-50 text-green-700 border-green-200">
                              运行中
                            </Badge>
                          </div>
                          <CardTitle className="text-sm font-semibold">{module.name}</CardTitle>
                          <CardDescription className="text-xs line-clamp-2">
                            {module.description || "暂无描述"}
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            ));
          })()
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <BarChart3 size={40} className="mb-4 opacity-30" />
            <p className="text-sm">暂无可访问的报表模块</p>
            <p className="text-xs mt-1">请联系管理员分配报表权限</p>
          </div>
        )}
      </div>
    </div>
  );
}
