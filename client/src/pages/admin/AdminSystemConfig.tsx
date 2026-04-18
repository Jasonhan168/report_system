import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Settings, RefreshCw, Save } from "lucide-react";

export default function AdminSystemConfig() {
  const { data: configs, isLoading, refetch } = trpc.systemConfigs.list.useQuery();
  const batchUpsert = trpc.systemConfigs.batchUpsert.useMutation({ onSuccess: () => { toast.success("配置已保存"); refetch(); } });

  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (configs) {
      const m: Record<string, string> = {};
      configs.forEach((c) => { m[c.key] = c.value ?? ""; });
      setForm(m);
    }
  }, [configs]);

  const CONFIG_GROUPS = [
    {
      title: "AD域认证配置",
      items: [
        { key: "ad_server_url", label: "AD服务器地址", placeholder: "ldap://192.168.1.1:389", description: "Windows域控制器LDAP地址" },
        { key: "ad_domain", label: "域名", placeholder: "company.com", description: "Windows域名" },
        { key: "ad_base_dn", label: "Base DN", placeholder: "DC=company,DC=com", description: "LDAP搜索基础DN" },
      ],
    },
    {
      title: "系统基础配置",
      items: [
        { key: "system_title", label: "系统标题", placeholder: "报表查询系统", description: "显示在页面标题栏" },
        { key: "session_timeout", label: "会话超时(分钟)", placeholder: "480", description: "用户登录会话有效时间" },
        { key: "max_export_rows", label: "最大导出行数", placeholder: "50000", description: "单次导出最大数据行数" },
      ],
    },
  ];

  const handleSave = () => {
    const items = Object.entries(form).map(([key, value]) => ({
      key, value,
      description: configs?.find((c) => c.key === key)?.description || "",
      category: configs?.find((c) => c.key === key)?.category || "system",
    }));
    batchUpsert.mutate(items);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">系统配置</h1>
          <p className="text-xs text-muted-foreground mt-0.5">配置系统关键参数，包括AD认证、数据库连接等</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5"><RefreshCw size={13} />刷新</Button>
          <Button size="sm" onClick={handleSave} disabled={batchUpsert.isPending} className="gap-1.5 bg-primary hover:bg-primary/90">
            <Save size={13} />{batchUpsert.isPending ? "保存中..." : "保存配置"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-6">
          {CONFIG_GROUPS.map((group) => (
            <div key={group.title} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-secondary/30 flex items-center gap-2">
                <Settings size={14} className="text-primary" />
                <span className="font-semibold text-sm">{group.title}</span>
              </div>
              <div className="p-5 space-y-4">
                {group.items.map((item) => (
                  <div key={item.key} className="grid grid-cols-3 gap-4 items-start">
                    <div>
                      <Label className="text-sm font-medium">{item.label}</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                    <div className="col-span-2">
                      <Input
                        className="h-9 text-sm"
                        placeholder={item.placeholder}
                        value={form[item.key] || ""}
                        onChange={(e) => setForm((f) => ({ ...f, [item.key]: e.target.value }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
