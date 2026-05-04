import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText, RefreshCw, Search, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

// 动作文案映射
const ACTION_LABELS: Record<string, { text: string; color: string }> = {
  login:         { text: "登录",       color: "bg-green-100 text-green-700 border-green-200" },
  login_failed:  { text: "登录失败",   color: "bg-red-100 text-red-700 border-red-200" },
  logout:        { text: "登出",       color: "bg-gray-100 text-gray-700 border-gray-200" },
  view:          { text: "查看",       color: "bg-blue-100 text-blue-700 border-blue-200" },
  export:        { text: "导出",       color: "bg-amber-100 text-amber-700 border-amber-200" },
  drill_down:    { text: "下钻",       color: "bg-purple-100 text-purple-700 border-purple-200" },
};

function formatTime(t: Date | string) {
  const d = t instanceof Date ? t : new Date(t);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatParams(p: unknown): string {
  if (p === null || p === undefined || p === "") return "";
  try {
    return typeof p === "string" ? p : JSON.stringify(p);
  } catch {
    return String(p);
  }
}

export default function AdminOperationLogs() {
  const today = new Date();
  const toInputDate = (d: Date) => d.toISOString().slice(0, 10);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const [action, setAction] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState(toInputDate(weekAgo));
  const [endDate, setEndDate] = useState(toInputDate(today));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [queryArgs, setQueryArgs] = useState<{
    action?: string;
    keyword?: string;
    startTime?: Date;
    endTime?: Date;
    page: number;
    pageSize: number;
  }>({
    startTime: new Date(`${toInputDate(weekAgo)}T00:00:00`),
    endTime: new Date(`${toInputDate(today)}T23:59:59`),
    page: 1,
    pageSize: 20,
  });

  const { data, isLoading, isFetching, refetch } = trpc.operationLogs.list.useQuery(queryArgs);

  const handleSearch = () => {
    setPage(1);
    setQueryArgs({
      action: action === "all" ? undefined : action,
      keyword: keyword.trim() || undefined,
      startTime: startDate ? new Date(`${startDate}T00:00:00`) : undefined,
      endTime: endDate ? new Date(`${endDate}T23:59:59`) : undefined,
      page: 1,
      pageSize,
    });
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setQueryArgs((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (val: string) => {
    const ps = parseInt(val);
    setPageSize(ps);
    setPage(1);
    setQueryArgs((prev) => ({ ...prev, pageSize: ps, page: 1 }));
  };

  const totalPages = data ? Math.ceil(data.total / queryArgs.pageSize) : 0;

  // 导出当前筛选条件下的日志
  const handleExport = () => {
    const params = new URLSearchParams();
    if (queryArgs.action) params.set("action", queryArgs.action);
    if (queryArgs.keyword) params.set("keyword", queryArgs.keyword);
    if (queryArgs.startTime) params.set("startTime", queryArgs.startTime.toISOString());
    if (queryArgs.endTime) params.set("endTime", queryArgs.endTime.toISOString());
    const url = `/api/export/operation-logs${params.toString() ? `?${params.toString()}` : ""}`;
    window.location.href = url;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ScrollText size={18} className="text-primary" />
            用户操作日志
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            记录登录、登出、报表查看、导出、下钻等用户操作，便于审计追溯
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isFetching || !data || data.total === 0} className="gap-1.5">
            <Download size={13} />
            导出 Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw size={13} className={cn(isFetching && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {/* 筛选条件 */}
      <div className="bg-card rounded-xl border border-border p-5 mb-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">操作类型</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="login">登录</SelectItem>
                <SelectItem value="login_failed">登录失败</SelectItem>
                <SelectItem value="logout">登出</SelectItem>
                <SelectItem value="view">查看报表</SelectItem>
                <SelectItem value="export">导出报表</SelectItem>
                <SelectItem value="drill_down">下钻</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">关键字（用户/报表）</Label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="姓名/账号/报表名"
              className="h-9 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">开始日期</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">结束日期</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={handleSearch} className="gap-1.5 bg-primary hover:bg-primary/90 h-9 w-full">
              <Search size={13} />
              查询
            </Button>
          </div>
        </div>
      </div>

      {/* 数据表 */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded" />
            ))}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">时间</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">用户</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">操作</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">报表/资源</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs">查询条件 / 参数</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">IP</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">结果</TableHead>
                    <TableHead className="px-3 py-2.5 text-xs whitespace-nowrap">耗时</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data && data.rows.length > 0 ? (
                    data.rows.map((log) => {
                      const act = ACTION_LABELS[log.action] || { text: log.action, color: "bg-gray-100 text-gray-700 border-gray-200" };
                      const paramsText = formatParams(log.params);
                      return (
                        <TableRow key={log.id} className="hover:bg-muted/40">
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap font-mono">{formatTime(log.createdAt)}</TableCell>
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap">
                            <div className="font-medium">{log.userName || "-"}</div>
                            <div className="text-muted-foreground text-[11px]">{log.userOpenId || ""}</div>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap">
                            <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", act.color)}>
                              {act.text}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap">
                            {log.resourceName || "-"}
                            {log.resourceCode && (
                              <div className="text-muted-foreground text-[11px] font-mono">{log.resourceCode}</div>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs max-w-[360px]">
                            <div className="truncate font-mono text-[11px]" title={paramsText}>
                              {paramsText}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap font-mono text-muted-foreground">{log.ip || "-"}</TableCell>
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap">
                            {log.success ? (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[11px]">成功</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[11px]" title={log.errorMsg ?? ""}>
                                失败
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                            {log.durationMs != null ? `${log.durationMs}ms` : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-10 text-sm">
                        暂无日志数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* 分页 */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs">
              <div className="text-muted-foreground">
                共 <span className="font-semibold text-foreground">{data?.total ?? 0}</span> 条
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">每页</span>
                  <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                    <SelectTrigger className="h-8 w-[72px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                    <ChevronLeft size={13} />
                  </Button>
                  <span className="min-w-[60px] text-center">
                    {page} / {totalPages || 1}
                  </span>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>
                    <ChevronRight size={13} />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
