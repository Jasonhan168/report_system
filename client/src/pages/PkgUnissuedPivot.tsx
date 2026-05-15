import { trpc } from "@/lib/trpc";
import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Download, Search, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { cn, localToday } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function fmtCell(n: number) {
  return n === 0 ? "" : n.toLocaleString("zh-CN");
}

export default function PkgUnissuedPivot() {
  const [, navigate] = useLocation();

  // 从 URL 读取返回时恢复的筛选条件
  const initParams = new URLSearchParams(window.location.search);
  const initPackageType = initParams.get("pivotPackageType") || "";
  const initProductionType = initParams.get("pivotProductionType") || "";

  const [packageType, setPackageType] = useState(initPackageType);
  const [productionType, setProductionType] = useState(initProductionType);
  const [pageSize, setPageSize] = useState(50);

  const [queryParams, setQueryParams] = useState({
    packageType: initPackageType, productionType: initProductionType, page: 1, pageSize: 50,
  });

  const { data: viewPerm } = trpc.pkgUnissuedPivot.checkPermission.useQuery({ type: "view" });
  const { data: exportPerm } = trpc.pkgUnissuedPivot.checkPermission.useQuery({ type: "export" });
  const { data: moduleMeta } = trpc.reportModules.getByCode.useQuery({ code: "pkg_unissued_pivot" });
  const { data: filterOpts } = trpc.pkgUnissuedPivot.filterOptions.useQuery(
    undefined,
    { enabled: !!viewPerm?.allowed },
  );
  const logClient = trpc.operationLogs.logClient.useMutation();

  // 下钻时记录日志并跳转
  const drillTo = useCallback(
    (targetCode: string, targetRoute: string, queryString: string, extraParams?: Record<string, unknown>) => {
      logClient.mutate({
        action: "drill_down",
        resourceCode: targetCode,
        params: { fromCode: "pkg_unissued_pivot", queryString, ...(extraParams ?? {}) },
      });
      navigate(`${targetRoute}?${queryString}`);
    },
    [logClient, navigate],
  );

  const { data, isLoading, isFetching, error, refetch } = trpc.pkgUnissuedPivot.query.useQuery(
    queryParams,
    { enabled: !!viewPerm?.allowed }
  );

  const handleSearch = useCallback(() => {
    setQueryParams({ packageType, productionType, page: 1, pageSize });
  }, [packageType, productionType, pageSize]);

  const handlePageChange = useCallback((newPage: number) => {
    setQueryParams((prev) => ({ ...prev, page: newPage }));
  }, []);

  const handlePageSizeChange = useCallback((val: string) => {
    const ps = parseInt(val);
    setPageSize(ps);
    setQueryParams((prev) => ({ ...prev, pageSize: ps, page: 1 }));
  }, []);

  const handleExport = useCallback(async () => {
    if (!exportPerm?.allowed) {
      toast.error("您没有导出权限");
      return;
    }
    try {
      const params = new URLSearchParams({
        ...(queryParams.packageType ? { packageType: queryParams.packageType } : {}),
        ...(queryParams.productionType ? { productionType: queryParams.productionType } : {}),
      });
      const resp = await fetch(`/api/export/pkg-unissued-pivot?${params.toString()}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "导出失败" }));
        toast.error(err.error || "导出失败，请重试");
        return;
      }
      const blob = await resp.blob();
      if (blob.size === 0) {
        toast.warning("没有可导出的数据");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const nameParts = ["封装订单未投数量统计表", localToday()];
      if (queryParams.packageType) nameParts.push(queryParams.packageType);
      if (queryParams.productionType) nameParts.push(queryParams.productionType);
      a.download = `${nameParts.join("_")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (e) {
      console.error(e);
      toast.error("导出失败，请重试");
    }
  }, [exportPerm, queryParams]);

  const totalPages = data ? Math.ceil(data.total / queryParams.pageSize) : 0;

  if (viewPerm && !viewPerm.allowed) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <AlertCircle size={40} className="opacity-40" />
        <p className="text-sm">您没有查看此报表的权限</p>
        <p className="text-xs">请联系管理员分配权限</p>
      </div>
    );
  }

  const vendors = data?.vendors ?? [];
  const colCount = 2 + vendors.length; // 封装形式 + 各供应商 + 合计
  const headers = ["封装形式", ...vendors, "合计"];

  return (
    <div className="p-6 report-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">封装订单未投数量统计表</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{moduleMeta?.description || ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw size={13} className={cn(isFetching && "animate-spin")} />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={!exportPerm?.allowed}
            className="gap-1.5 bg-primary hover:bg-primary/90"
          >
            <Download size={13} />
            导出Excel
          </Button>
        </div>
      </div>

      {/* 查询条件 */}
      <div className="bg-card rounded-xl border border-border p-5 mb-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              封装形式
              <span className="ml-1 text-muted-foreground/60 font-normal">（模糊匹配）</span>
            </Label>
            <Input
              value={packageType}
              onChange={(e) => setPackageType(e.target.value)}
              placeholder="全部"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              工程/量产
            </Label>
            <select
              value={productionType}
              onChange={(e) => setProductionType(e.target.value)}
              className="h-9 w-full text-sm rounded-md border border-border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">全部</option>
              {(filterOpts?.productionTypes ?? []).map((pt) => (
                <option key={pt} value={pt}>{pt}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={handleSearch}
              className="w-full h-9 gap-1.5 bg-primary hover:bg-primary/90"
              size="sm"
            >
              <Search size={13} />
              查询
            </Button>
          </div>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground">
                共 <span className="font-semibold text-foreground">{data.total}</span> 种封装形式
              </span>
            )}
            {isFetching && !isLoading && (
              <Badge variant="secondary" className="text-xs">更新中...</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">每页</span>
            <select
              value={String(queryParams.pageSize)}
              onChange={(e) => handlePageSizeChange(e.target.value)}
              className="h-7 w-16 text-xs rounded border border-border bg-background px-1"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>{n}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">条</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                {headers.map((h, i) => (
                  <TableHead
                    key={h}
                    className={cn(
                      "text-xs font-semibold text-foreground whitespace-nowrap px-3 py-3",
                      i > 0 && "text-right"
                    )}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: colCount }).map((_, j) => (
                      <TableCell key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center py-12 text-muted-foreground">
                    <AlertCircle size={24} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">加载失败，请重试</p>
                  </TableCell>
                </TableRow>
              ) : data?.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center py-12 text-muted-foreground text-sm">暂无数据</TableCell>
                </TableRow>
              ) : (
                <>
                  {data?.rows.map((row, idx) => {
                    // 返回统计表时恢复筛选用的参数
                    const pivotBack = {
                      ...(queryParams.packageType ? { pivotPackageType: queryParams.packageType } : {}),
                      ...(queryParams.productionType ? { pivotProductionType: queryParams.productionType } : {}),
                    };
                    return (
                    <TableRow key={idx} className={cn("transition-colors", idx % 2 === 0 ? "bg-white" : "bg-[oklch(0.975_0.005_252)]")}>
                      <TableCell className="px-3 py-2.5 font-medium text-xs">{row.packageType}</TableCell>
                      {vendors.map((v) => {
                        const qty = row.values[v] ?? 0;
                        return (
                          <TableCell key={v} className="px-3 py-2.5 text-right text-xs">
                            {qty !== 0 ? (
                              <button
                                type="button"
                                className="text-blue-600 underline hover:text-blue-400 transition-colors cursor-pointer"
                                onClick={() => {
                                  const detailParams = new URLSearchParams({
                                    vendorName: v,
                                    packageType: row.packageType,
                                    ...(queryParams.productionType ? { productionType: queryParams.productionType } : {}),
                                    fromPivot: "1",
                                    backRoute: "/reports/pkg-unissued-pivot",
                                    ...pivotBack,
                                  }).toString();
                                  drillTo("order_wip_detail", "/reports/order-wip-detail", detailParams, { vendorName: v, packageType: row.packageType, productionType: queryParams.productionType || undefined });
                                }}
                              >
                                {fmtCell(qty)}
                              </button>
                            ) : ""}
                          </TableCell>
                        );
                      })}
                      <TableCell className="px-3 py-2.5 text-right text-xs font-semibold">
                        {fmtCell(row.rowTotal)}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {data?.totalRow && (
                    <TableRow className="bg-[oklch(0.93_0.02_252)] border-t-2 border-primary/20">
                      <TableCell className="px-3 py-3 font-bold text-xs text-primary">合计</TableCell>
                      {vendors.map((v) => (
                        <TableCell key={v} className="px-3 py-3 text-right text-xs font-bold">
                          {fmtCell(data.colTotals[v] ?? 0)}
                        </TableCell>
                      ))}
                      <TableCell className="px-3 py-3 text-right text-xs font-bold text-primary">
                        {fmtCell(data.grandTotal)}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
            <span className="text-xs text-muted-foreground">第 {queryParams.page} / {totalPages} 页</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={queryParams.page <= 1} onClick={() => handlePageChange(queryParams.page - 1)}>
                <ChevronLeft size={13} />
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p = i + 1;
                if (totalPages > 5) {
                  if (queryParams.page <= 3) p = i + 1;
                  else if (queryParams.page >= totalPages - 2) p = totalPages - 4 + i;
                  else p = queryParams.page - 2 + i;
                }
                return (
                  <Button key={p} variant={p === queryParams.page ? "default" : "outline"} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => handlePageChange(p)}>
                    {p}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={queryParams.page >= totalPages} onClick={() => handlePageChange(queryParams.page + 1)}>
                <ChevronRight size={13} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
