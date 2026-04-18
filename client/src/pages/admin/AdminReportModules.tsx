import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileText, RefreshCw, Pencil } from "lucide-react";

type Module = {
  id: number;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  route: string | null;
  sortOrder: number;
  isActive: boolean;
  datasourceId?: number | null;
};

export default function AdminReportModules() {
  const { data: modules, isLoading, refetch } = trpc.reportModules.listAll.useQuery();
  const update = trpc.reportModules.update.useMutation({
    onSuccess: () => { toast.success("已更新"); refetch(); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<Module | null>(null);
  const [form, setForm] = useState({ name: "", category: "", description: "", route: "", sortOrder: 0 });

  function openEdit(m: Module) {
    setForm({
      name: m.name,
      category: m.category || "",
      description: m.description || "",
      route: m.route || "",
      sortOrder: m.sortOrder,
    });
    setEditing(m);
  }

  function handleSave() {
    if (!editing) return;
    update.mutate({
      id: editing.id,
      name: form.name || undefined,
      category: form.category || undefined,
      description: form.description || undefined,
      route: form.route || undefined,
      sortOrder: form.sortOrder,
    });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">报表模块管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理系统中的报表模块及其状态和路由配置</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw size={13} />刷新
        </Button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              {["模块代码", "模块名称", "分类", "路由地址", "排序", "状态", "操作"].map(h => (
                <TableHead key={h} className="text-xs font-semibold px-4">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : modules?.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.code}</TableCell>
                <TableCell className="px-4 py-3 font-medium text-sm">{m.name}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{m.category || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs font-mono">
                  {m.route ? (
                    <span className="text-primary">{m.route}</span>
                  ) : (
                    <span className="text-muted-foreground italic">未配置</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs">{m.sortOrder}</TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={m.isActive}
                      onCheckedChange={(checked) => update.mutate({ id: m.id, isActive: checked })}
                      className="scale-75"
                    />
                    <Badge variant={m.isActive ? "default" : "secondary"} className="text-xs">
                      {m.isActive ? "启用" : "禁用"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => openEdit(m as Module)}>
                    <Pencil size={12} />编辑
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={16} />
              编辑报表模块
              <span className="font-mono text-xs text-muted-foreground ml-1">({editing?.code})</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">模块名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="报表显示名称"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">分类</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="如：封装厂报表、测试报表"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                路由地址
                <span className="text-muted-foreground font-normal ml-1 text-xs">（首页卡片点击后跳转的路径）</span>
              </Label>
              <Input
                value={form.route}
                onChange={(e) => setForm(f => ({ ...f, route: e.target.value }))}
                placeholder="如：/reports/pkg-wip-summary"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                留空则首页卡片显示"暂未配置路由"，填写后用户点击即可跳转对应报表页面
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">描述</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="报表功能简要说明"
                rows={3}
                className="resize-none text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">排序</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm(f => ({ ...f, sortOrder: Number(e.target.value) }))}
                className="w-24"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
