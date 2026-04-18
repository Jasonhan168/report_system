import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Shield, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export default function AdminPermissions() {
  const { data: allPerms, isLoading, refetch } = trpc.permissions.listAll.useQuery();
  const { data: modules } = trpc.reportModules.listAll.useQuery();
  const { data: users } = trpc.users.list.useQuery();
  const upsert = trpc.permissions.upsert.useMutation({ onSuccess: () => { toast.success("权限已更新"); refetch(); } });
  const [expandedModule, setExpandedModule] = useState<number | null>(null);

  const getPermission = (userId: number, moduleId: number) =>
    allPerms?.find((p) => p.userId === userId && p.reportModuleId === moduleId);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">报表权限配置</h1>
          <p className="text-xs text-muted-foreground mt-0.5">为用户分配各报表的查看和导出权限</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw size={13} />刷新
        </Button>
      </div>
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
        ) : modules?.map((module) => (
          <div key={module.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-secondary/30 transition-colors text-left"
              onClick={() => setExpandedModule(expandedModule === module.id ? null : module.id)}
            >
              <Shield size={16} className="text-primary flex-shrink-0" />
              <div className="flex-1">
                <span className="font-semibold text-sm">{module.name}</span>
                <span className="text-xs text-muted-foreground ml-2">({module.code})</span>
              </div>
              {expandedModule === module.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {expandedModule === module.id && (
              <div className="border-t border-border">
                <div className="grid grid-cols-4 bg-secondary/50 px-5 py-2.5 text-xs font-semibold text-muted-foreground">
                  <span>用户</span><span>邮箱</span>
                  <span className="text-center">查看权限</span><span className="text-center">导出权限</span>
                </div>
                {users?.map((user) => {
                  const perm = getPermission(user.id, module.id);
                  const canView = perm?.canView ?? false;
                  const canExport = perm?.canExport ?? false;
                  return (
                    <div key={user.id} className="grid grid-cols-4 px-5 py-3 border-t border-border/50 items-center hover:bg-secondary/20 transition-colors">
                      <span className="text-sm font-medium">{user.name || "-"}</span>
                      <span className="text-xs text-muted-foreground">{user.email || "-"}</span>
                      <div className="flex justify-center">
                        <Switch checked={canView} onCheckedChange={(checked) => upsert.mutate({ userId: user.id, reportModuleId: module.id, canView: checked, canExport: checked ? canExport : false })} />
                      </div>
                      <div className="flex justify-center">
                        <Switch checked={canExport} disabled={!canView} onCheckedChange={(checked) => upsert.mutate({ userId: user.id, reportModuleId: module.id, canView, canExport: checked })} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
