import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

type Account = inferRouterOutputs<AppRouter>["users"]["list"][number];
type Company = inferRouterOutputs<AppRouter>["companies"]["list"][number];
const scopeLabels = { none: "待授权", own: "本公司", all: "全部分公司" };
const authLabels = { local: "本地密码", ldap: "AD", oauth: "OAuth" };
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, RefreshCw, UserPlus, KeyRound, Loader2 } from "lucide-react";

// ─── 创建用户对话框 ────────────────────────────────────────────────────────────
function CreateUserDialog({ user, companies, onClose, onSuccess }: {
  user?: Account;
  companies: Company[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    username: user?.openId ?? "", displayName: user?.name ?? "",
    email: user?.email ?? "", department: user?.department ?? "", password: "",
    role: user?.role ?? "user", authType: user?.authType ?? "ldap",
    dataScope: user?.dataScope ?? "none", companyId: user?.companyId ?? null,
  });
  const [error, setError] = useState("");
  const save = trpc.users.save.useMutation({
    onSuccess: () => { toast.success("账号配置已保存，旧会话已撤销"); onSuccess(); onClose(); },
    onError: err => setError(err.message),
  });
  const submit = () => {
    if (!form.username.trim() || !form.displayName.trim()) return setError("请填写用户名和显示名");
    if (form.dataScope === "own" && !form.companyId) return setError("请选择所属分公司");
    if (form.authType === "local" && (!user || user.authType !== "local") && !form.password) return setError("新本地账号必须设置密码");
    if (form.password && (form.password.length < 6 || new TextEncoder().encode(form.password).length > 72)) return setError("密码至少6位且不超过72字节");
    save.mutate({ ...form, userId: user?.id, password: form.authType === "local" ? form.password || undefined : undefined });
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user ? "编辑账号配置" : "创建用户"}</DialogTitle>
          <DialogDescription>认证方式、数据范围与报表权限分别配置；普通用户不会因全范围授权获得管理权限。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2"><Label htmlFor="account-name">用户名</Label><Input id="account-name" disabled={!!user} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="AD账号使用短账号" /></div>
          <div className="space-y-2"><Label htmlFor="account-display">显示名</Label><Input id="account-display" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="account-email">邮箱</Label><Input id="account-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="account-dept">部门</Label><Input id="account-dept" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></div>
          <div className="space-y-2"><Label>认证方式</Label>
            <Select value={form.authType} onValueChange={v => setForm({ ...form, authType: v as Account["authType"], password: "" })}>
              <SelectTrigger aria-label="认证方式"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="ldap">AD域认证</SelectItem><SelectItem value="local">本地密码</SelectItem>
                {user?.authType === "oauth" && <SelectItem value="oauth">OAuth（已有账号）</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>角色</Label>
            <Select value={form.role} onValueChange={v => setForm({ ...form, role: v as Account["role"], dataScope: v === "admin" ? "all" : form.dataScope })}>
              <SelectTrigger aria-label="角色"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">普通用户</SelectItem><SelectItem value="admin">系统管理员</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>数据范围</Label>
            <Select disabled={form.role === "admin"} value={form.dataScope} onValueChange={v => setForm({ ...form, dataScope: v as Account["dataScope"] })}>
              <SelectTrigger aria-label="数据范围"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(scopeLabels).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>所属分公司</Label>
            <Select value={form.companyId?.toString() ?? "unset"} onValueChange={v => setForm({ ...form, companyId: v === "unset" ? null : Number(v) })}>
              <SelectTrigger aria-label="所属分公司"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="unset">未配置</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={String(c.id)} disabled={!c.isActive}>{c.name}（{c.plant}）{!c.isActive && " · 已停用"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {form.authType === "local" && <div className="space-y-2 col-span-2"><Label htmlFor="account-password">{user?.authType === "local" ? "新密码（留空不修改）" : "初始密码（必填）"}</Label><Input id="account-password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>}
          {user && user.authType !== form.authType && <p className="col-span-2 text-sm text-amber-700">正在更改账号认证策略：切换到 AD 将清除本地密码，切换到本地必须设置新密码。保存后旧会话失效。</p>}
          <p className="col-span-2 text-xs text-muted-foreground">保存后请在“报表权限”中分配可查看、可导出的报表。仅配置分公司或范围不会自动授予报表权限。</p>
          {error && <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={submit} disabled={save.isPending}>{save.isPending ? "保存中..." : "保存账号"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 重置密码对话框 ────────────────────────────────────────────────────────────
function ResetPasswordDialog({
  open,
  userId,
  userName,
  onClose,
}: {
  open: boolean;
  userId: number;
  userName: string;
  onClose: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");

  const resetPassword = trpc.users.resetPassword.useMutation({
    onSuccess: () => {
      toast.success(`已重置 ${userName} 的密码`);
      onClose();
      setNewPassword("");
      setError("");
    },
    onError: (err) => {
      toast.error(err.message || "重置失败");
    },
  });

  const handleSubmit = () => {
    if (!newPassword) { setError("请输入新密码"); return; }
    if (newPassword.length < 6 || new TextEncoder().encode(newPassword).length > 72) { setError("密码至少6位且不超过72字节"); return; }
    setError("");
    resetPassword.mutate({ userId, newPassword });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={16} />
            重置密码
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            为用户 <span className="font-semibold text-foreground">{userName}</span> 设置新密码
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">新密码</Label>
            <Input
              type="password"
              placeholder="至少6位"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-9 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={resetPassword.isPending}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={resetPassword.isPending}>
            {resetPassword.isPending ? <><Loader2 size={13} className="mr-1.5 animate-spin" />重置中...</> : "确认重置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────────────────────
function CompanyManager({ companies, onClose }: { companies: Company[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const empty = { id: undefined as number | undefined, plant: "", name: "", isActive: true };
  const [form, setForm] = useState(empty);
  const save = trpc.companies.save.useMutation({
    onSuccess: () => { toast.success("分公司已保存"); utils.companies.list.invalidate(); setForm(empty); },
    onError: err => toast.error(err.message),
  });
  return <Dialog open onOpenChange={v => !v && onClose()}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>分公司管理</DialogTitle><DialogDescription>编码须与数仓 plant 完全一致，创建后不可修改。停用后所属本公司范围用户将失去业务访问权限。</DialogDescription></DialogHeader>
    <Table><TableHeader><TableRow><TableHead>编码</TableHead><TableHead>名称</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
      <TableBody>{companies.map(c => <TableRow key={c.id}><TableCell>{c.plant}</TableCell><TableCell>{c.name}</TableCell><TableCell>{c.isActive ? "启用" : "停用"}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => setForm(c)}>编辑</Button></TableCell></TableRow>)}</TableBody>
    </Table>
    <div className="space-y-3 border-t pt-4">
      <p className="text-sm font-medium">{form.id ? "编辑分公司" : "新增分公司"}</p>
      <Label htmlFor="company-plant">分公司编码</Label><Input id="company-plant" disabled={!!form.id} placeholder="与数仓 plant 一致" value={form.plant} onChange={e => setForm({ ...form, plant: e.target.value })} />
      <Label htmlFor="company-name">分公司名称</Label><Input id="company-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      <div className="flex items-center gap-2"><Switch id="company-active" checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} /><Label htmlFor="company-active">启用</Label></div>
    </div>
    <DialogFooter><Button variant="outline" onClick={() => setForm(empty)}>清空 / 新增</Button><Button disabled={save.isPending || !form.plant.trim() || !form.name.trim()} onClick={() => save.mutate(form)}>保存分公司</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export default function AdminUsers() {
  const { data: users, isLoading, refetch } = trpc.users.list.useQuery();
  const { data: companies = [] } = trpc.companies.list.useQuery();
  const setActive = trpc.users.setActive.useMutation({
    onSuccess: () => { toast.success("状态已更新"); refetch(); },
    onError: err => toast.error(err.message),
  });
  const [editor, setEditor] = useState<Account | "new" | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">用户管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理系统用户账号及角色权限</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCompanyOpen(true)}>分公司管理</Button>
          <Button size="sm" onClick={() => setEditor("new")} className="gap-1.5"><UserPlus size={13} />新建用户</Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw size={13} />刷新
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
          <Users size={14} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            共 <span className="font-semibold text-foreground">{users?.length || 0}</span> 个用户
          </span>
          <Badge variant="outline" className="ml-auto text-xs">按账号配置认证方式与数据范围</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              {["用户名 / 姓名", "邮箱", "认证方式", "角色", "分公司 / 范围", "状态", "注册时间", "最后登录", "操作"].map(h => (
                <TableHead key={h} className="text-xs font-semibold px-4">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : users?.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="px-4 py-3 font-medium text-sm">{user.openId}<div className="text-xs text-muted-foreground">{user.name}</div></TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">{user.email || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{authLabels[user.authType]}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{user.role === "admin" ? "系统管理员" : "普通用户"}</TableCell>
                <TableCell className="px-4 py-3 text-xs">
                  <div>{companies.find(c => c.id === user.companyId)?.name ?? "未配置"}</div>
                  <Badge variant="outline">{scopeLabels[user.dataScope]}</Badge>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={user.isActive}
                      onCheckedChange={(checked) => setActive.mutate({ userId: user.id, isActive: checked })}
                      className="scale-75"
                    />
                    <Badge variant={user.isActive ? "default" : "secondary"} className="text-xs">
                      {user.isActive ? "启用" : "禁用"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(user.lastSignedIn).toLocaleString("zh-CN")}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Button variant="ghost" size="sm" onClick={() => setEditor(user)}>编辑</Button>
                  {user.authType === "local" && <Button variant="ghost" size="sm" onClick={() => setResetTarget({ id: user.id, name: user.name || user.openId })}><KeyRound size={11} />重置密码</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 创建用户对话框 */}
      {editor && <CreateUserDialog user={editor === "new" ? undefined : editor} companies={companies} onClose={() => setEditor(null)} onSuccess={() => refetch()} />}
      {companyOpen && <CompanyManager companies={companies} onClose={() => setCompanyOpen(false)} />}

      {/* 重置密码对话框 */}
      {resetTarget && (
        <ResetPasswordDialog
          open={true}
          userId={resetTarget.id}
          userName={resetTarget.name}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}
