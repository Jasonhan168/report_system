import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Database, RefreshCw, Plus, Trash2, Zap } from "lucide-react";

const DS_TYPES = ["mysql", "clickhouse", "oracle", "mock"] as const;

export default function AdminDatasources() {
  const { data: datasources, isLoading, refetch } = trpc.datasources.list.useQuery();
  const create = trpc.datasources.create.useMutation({ onSuccess: () => { toast.success("数据源已创建"); refetch(); setShowCreate(false); } });
  const del = trpc.datasources.delete.useMutation({ onSuccess: () => { toast.success("已删除"); refetch(); } });
  const testConn = trpc.datasources.testConnection.useMutation({
    onSuccess: (d) => toast.success(d.message),
    onError: () => toast.error("连接失败"),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", type: "mysql" as typeof DS_TYPES[number], host: "", port: 3306, database: "", username: "", password: "" });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">数据源配置</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理报表数据源连接配置</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5"><RefreshCw size={13} />刷新</Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5 bg-primary hover:bg-primary/90"><Plus size={13} />新增数据源</Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              {["名称","类型","主机","端口","数据库","用户名","操作"].map(h => (
                <TableHead key={h} className="text-xs font-semibold px-4">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              ))
            ) : datasources?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">暂无数据源，请点击"新增数据源"</TableCell></TableRow>
            ) : datasources?.map((ds) => (
              <TableRow key={ds.id}>
                <TableCell className="px-4 py-3 font-medium text-sm">{ds.name}</TableCell>
                <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-mono uppercase">{ds.type}</Badge></TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">{ds.host || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{ds.port || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{ds.database || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{ds.username || "-"}</TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => testConn.mutate({ id: ds.id })}><Zap size={11} />测试</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive gap-1" onClick={() => del.mutate({ id: ds.id })}><Trash2 size={11} />删除</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新增数据源</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">名称 *</Label>
              <Input className="h-9" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="数据源名称" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">类型 *</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v as typeof DS_TYPES[number] }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{DS_TYPES.map(t => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">端口</Label>
              <Input className="h-9" type="number" value={form.port} onChange={(e) => setForm(f => ({ ...f, port: parseInt(e.target.value) || 3306 }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">主机</Label>
              <Input className="h-9" value={form.host} onChange={(e) => setForm(f => ({ ...f, host: e.target.value }))} placeholder="localhost" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">数据库</Label>
              <Input className="h-9" value={form.database} onChange={(e) => setForm(f => ({ ...f, database: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">用户名</Label>
              <Input className="h-9" value={form.username} onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">密码</Label>
              <Input className="h-9" type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={() => create.mutate(form)} disabled={!form.name || create.isPending} className="bg-primary hover:bg-primary/90">
              {create.isPending ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
