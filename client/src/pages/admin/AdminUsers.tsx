import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
function CreateUserDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    email: "",
    role: "user" as "user" | "admin",
    department: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createUser = trpc.users.create.useMutation({
    onSuccess: () => {
      toast.success("用户创建成功");
      onSuccess();
      onClose();
      setForm({ username: "", displayName: "", password: "", email: "", role: "user", department: "" });
      setErrors({});
    },
    onError: (err) => {
      toast.error(err.message || "创建失败");
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = "用户名不能为空";
    else if (!/^[a-zA-Z0-9_.-]+$/.test(form.username)) e.username = "只能包含字母、数字、下划线、点和连字符";
    if (!form.displayName.trim()) e.displayName = "显示名不能为空";
    if (!form.password) e.password = "密码不能为空";
    else if (form.password.length < 6) e.password = "密码至少6位";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "邮箱格式不正确";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    createUser.mutate({
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      password: form.password,
      email: form.email.trim() || undefined,
      role: form.role,
      department: form.department.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus size={16} />
            创建本地用户
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            仅在本地认证模式（AUTH_MODE=local）下可用
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">用户名 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="登录用户名"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="h-9 text-sm"
              />
              {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">显示名 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="姓名/昵称"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="h-9 text-sm"
              />
              {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">初始密码 <span className="text-destructive">*</span></Label>
            <Input
              type="password"
              placeholder="至少6位"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="h-9 text-sm"
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">邮箱</Label>
              <Input
                type="email"
                placeholder="可选"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-9 text-sm"
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">部门</Label>
              <Input
                placeholder="可选"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">角色</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "user" | "admin" })}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">普通用户</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={createUser.isPending}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={createUser.isPending}>
            {createUser.isPending ? <><Loader2 size={13} className="mr-1.5 animate-spin" />创建中...</> : "创建用户"}
          </Button>
        </DialogFooter>
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
    if (newPassword.length < 6) { setError("密码至少6位"); return; }
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
export default function AdminUsers() {
  const { data: users, isLoading, refetch } = trpc.users.list.useQuery();
  const { data: authModeData } = trpc.auth.authMode.useQuery();
  const isLocalMode = authModeData?.mode === "local";

  const setRole = trpc.users.setRole.useMutation({ onSuccess: () => { toast.success("角色已更新"); refetch(); } });
  const setActive = trpc.users.setActive.useMutation({ onSuccess: () => { toast.success("状态已更新"); refetch(); } });

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">用户管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理系统用户账号及角色权限</p>
        </div>
        <div className="flex items-center gap-2">
          {isLocalMode && (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <UserPlus size={13} />
              新建用户
            </Button>
          )}
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
          {authModeData && (
            <Badge variant="outline" className="ml-auto text-xs">
              认证模式：{authModeData.mode === "local" ? "本地账号" : authModeData.mode === "ldap" ? "AD域" : "OAuth"}
            </Badge>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              {["用户名", "邮箱", "登录方式", "角色", "状态", "注册时间", "最后登录", ...(isLocalMode ? ["操作"] : [])].map(h => (
                <TableHead key={h} className="text-xs font-semibold px-4">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: isLocalMode ? 8 : 7 }).map((_, j) => (
                    <TableCell key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : users?.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="px-4 py-3 font-medium text-sm">{user.name || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs text-muted-foreground">{user.email || "-"}</TableCell>
                <TableCell className="px-4 py-3 text-xs">{user.loginMethod || "-"}</TableCell>
                <TableCell className="px-4 py-3">
                  <Select
                    value={user.role}
                    onValueChange={(val) => setRole.mutate({ userId: user.id, role: val as "user" | "admin" })}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">普通用户</SelectItem>
                      <SelectItem value="admin">管理员</SelectItem>
                    </SelectContent>
                  </Select>
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
                {isLocalMode && (
                  <TableCell className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => setResetTarget({ id: user.id, name: user.name || user.openId })}
                    >
                      <KeyRound size={11} />
                      重置密码
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 创建用户对话框 */}
      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => refetch()}
      />

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
