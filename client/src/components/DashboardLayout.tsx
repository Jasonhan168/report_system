import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  BarChart3, ChevronRight, Database, FileText, Home,
  List, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, Shield, Users,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

// 根据报表 code 或路由推断图标
function getModuleIcon(code: string, route?: string | null) {
  if (code.includes("wip_summary") || code.includes("summary")) return BarChart3;
  if (code.includes("wip_detail") || route?.includes("wip-detail")) return List;
  if (code.includes("order") || code.includes("outsource")) return FileText;
  return BarChart3;
}

// 管理菜单（固定）
const ADMIN_ITEMS = [
  { label: "用户管理", href: "/admin/users", icon: Users },
  { label: "报表权限", href: "/admin/permissions", icon: Shield },
  { label: "报表模块", href: "/admin/report-modules", icon: FileText },
  { label: "数据源配置", href: "/admin/datasources", icon: Database },
  { label: "系统配置", href: "/admin/system-config", icon: Settings },
];

// 单个导航项
function NavItem({
  href, label, icon: Icon, isActive, collapsed, onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link href={href}>
        <div
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg text-sm transition-all cursor-pointer select-none",
            collapsed ? "px-2 py-2.5 justify-center" : "px-3 py-2.5",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <Icon
            size={15}
            className={cn("flex-shrink-0", isActive ? "text-[oklch(0.72_0.16_75)]" : "")}
          />
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{label}</span>
              {isActive && (
                <ChevronRight size={13} className="text-[oklch(0.72_0.16_75)] flex-shrink-0" />
              )}
            </>
          )}
        </div>
      </Link>
    </li>
  );
}

function SidebarNav({
  isAdmin,
  location,
  collapsed = false,
  onNavigate,
}: {
  isAdmin: boolean;
  location: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  // 动态加载报表模块列表
  const { data: modulesData } = trpc.reportModules.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  // 按 category 分组，保持 sortOrder 排序
  const reportGroups = useMemo(() => {
    if (!modulesData) return [];
    type Mod = (typeof modulesData)[number];
    const active: Mod[] = modulesData
      .filter((m: Mod) => m.isActive && m.route)
      .sort((a: Mod, b: Mod) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const groupMap = new Map<string, Mod[]>();
    for (const mod of active) {
      const cat = mod.category || "报表";
      if (!groupMap.has(cat)) groupMap.set(cat, []);
      groupMap.get(cat)!.push(mod);
    }
    return Array.from(groupMap.entries()).map(([cat, items]) => ({ cat, items }));
  }, [modulesData]);

  return (
    <nav className="flex-1 overflow-y-auto py-4 px-2">
      {/* 工作台 */}
      <div className="mb-4">
        {!collapsed && (
          <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest px-3 mb-1.5">
            工作台
          </p>
        )}
        <ul className="space-y-0.5">
          <NavItem href="/" label="系统首页" icon={Home} isActive={location === "/"} collapsed={collapsed} onNavigate={onNavigate} />
        </ul>
      </div>

      {/* 动态报表分组 */}
      {reportGroups.map(({ cat, items }) => (
        <div key={cat} className="mb-4">
          {!collapsed && (
            <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest px-3 mb-1.5">
              {cat}
            </p>
          )}
          <ul className="space-y-0.5">
            {items.map((mod) => (
              <NavItem
                key={mod.code}
                href={mod.route!}
                label={mod.name}
                icon={getModuleIcon(mod.code, mod.route)}
                isActive={location === mod.route}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ))}

      {/* 系统管理（仅管理员） */}
      {isAdmin && (
        <div className="mb-4">
          {!collapsed && (
            <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest px-3 mb-1.5">
              系统管理
            </p>
          )}
          <ul className="space-y-0.5">
            {ADMIN_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={location === item.href}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // 桌面侧边栏折叠状态，默认展开
  const [collapsed, setCollapsed] = useState(false);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => { window.location.href = "/login"; },
  });
  // 加载报表模块列表（用于页面标题匹配）
  const { data: reportModulesForLabel } = trpc.reportModules.list.useQuery(undefined, {
    staleTime: 30_000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      window.location.href = "/login";
    }
  }, [loading, isAuthenticated]);

  // 路由切换时关闭移动端菜单
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!isAuthenticated) return <DashboardLayoutSkeleton />;

  const isAdmin = user?.role === "admin";
  // 页面标题：从管理菜单和工作台固定项中匹配
  const STATIC_ITEMS = [
    { href: "/", label: "系统首页" },
    ...ADMIN_ITEMS.map((i) => ({ href: i.href, label: i.label })),
  ];
  const currentLabel =
    STATIC_ITEMS.find((item) => item.href === location)?.label ||
    reportModulesForLabel?.find((m) => m.route === location)?.name ||
    "系统首页";

  const UserMenu = ({ mini = false }: { mini?: boolean }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(
          "w-full flex items-center rounded-lg hover:bg-sidebar-accent/60 transition-colors cursor-pointer text-left",
          mini ? "px-2 py-2 justify-center" : "gap-3 px-3 py-2.5"
        )}>
          <Avatar className="w-8 h-8 flex-shrink-0">
            <AvatarFallback className="bg-[oklch(0.72_0.16_75)] text-[oklch(0.15_0.05_75)] text-xs font-bold">
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          {!mini && (
            <div className="flex-1 min-w-0">
              <p className="text-sidebar-foreground text-sm font-medium truncate">{user?.name || "用户"}</p>
              <p className="text-sidebar-foreground/45 text-xs">{isAdmin ? "管理员" : "普通用户"}</p>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <div className="px-3 py-2">
          <p className="text-sm font-medium">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email || (isAdmin ? "管理员" : "普通用户")}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer"
          onClick={() => logout.mutate()}
        >
          <LogOut size={14} className="mr-2" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* 桌面侧边栏 */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar flex-shrink-0 shadow-lg transition-all duration-200",
          collapsed ? "w-[52px]" : "w-[220px]"
        )}
      >
        {/* Logo / 折叠按钮 */}
        <div className={cn(
          "flex items-center h-14 border-b border-sidebar-border flex-shrink-0",
          collapsed ? "justify-center px-2" : "gap-3 px-5"
        )}>
          {!collapsed && (
            <>
              <div className="w-7 h-7 rounded-md bg-[oklch(0.72_0.16_75)] flex items-center justify-center flex-shrink-0">
                <BarChart3 size={14} className="text-[oklch(0.15_0.05_75)]" />
              </div>
              <span className="text-sidebar-foreground font-semibold text-sm tracking-wide flex-1 truncate">报表查询系统</span>
            </>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            className="p-1.5 rounded-md hover:bg-sidebar-accent/60 transition-colors text-sidebar-foreground/60 hover:text-sidebar-foreground flex-shrink-0"
          >
            {collapsed
              ? <PanelLeftOpen size={15} />
              : <PanelLeftClose size={15} />
            }
          </button>
        </div>

        <SidebarNav isAdmin={isAdmin} location={location} collapsed={collapsed} />

        {/* 用户信息 */}
        <div className="border-t border-sidebar-border p-2 flex-shrink-0">
          <UserMenu mini={collapsed} />
        </div>
      </aside>

      {/* 移动端侧边栏遮罩 + 抽屉 */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar flex flex-col shadow-2xl">
            <div className="flex items-center gap-3 px-5 h-14 border-b border-sidebar-border">
              <div className="w-7 h-7 rounded-md bg-[oklch(0.72_0.16_75)] flex items-center justify-center">
                <BarChart3 size={14} className="text-[oklch(0.15_0.05_75)]" />
              </div>
              <span className="text-sidebar-foreground font-semibold text-sm">报表查询系统</span>
            </div>
            <SidebarNav isAdmin={isAdmin} location={location} onNavigate={() => setMobileOpen(false)} />
            <div className="border-t border-sidebar-border p-2">
              <UserMenu />
            </div>
          </aside>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* 顶部栏 */}
        <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 flex-shrink-0 shadow-sm">
          {/* 移动端菜单按钮 */}
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-secondary transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <Menu size={18} />
          </button>

          <div className="flex-1 flex items-center gap-2 text-sm min-w-0">
            <span className="text-muted-foreground shrink-0">报表查询系统</span>
            <ChevronRight size={13} className="text-muted-foreground/50 shrink-0" />
            <span className="font-medium text-foreground truncate">{currentLabel}</span>
          </div>

          <div className="hidden lg:flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-full font-medium">
              {isAdmin ? "管理员" : "普通用户"}
            </span>
            <span className="text-sm font-medium text-foreground">{user?.name}</span>
          </div>
        </header>

        {/* 页面内容：flex-1 + overflow-y-auto 保证占满剩余高度 */}
        <main className="flex-1 overflow-y-auto min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
