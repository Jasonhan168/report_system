import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAutoTitles } from "@/hooks/useAutoTitles";
import { useSearch, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, RefreshCw, Search, Filter } from "lucide-react";
import { toast } from "sonner";

function fmt(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (isNaN(n) || n === 0) return "";
  return n.toLocaleString();
}

function fmtTotal(v: number): string {
  if (v === 0) return "";
  return v.toLocaleString();
}

export default function PkgWipInprocDetail() {
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const [, navigate] = useLocation();

  // 汇总表跳转过来的标识 + 返回路由 + 要恢复的筛选
  const fromSummary = sp.get("fromSummary") === "1";
  const backRoute = sp.get("backRoute") || "/reports/pkg-wip-inproc-summary";
  const summaryLabelName = sp.get("summaryLabelName") ?? "";
  const summaryVendorName = sp.get("summaryVendorName") ?? "";

  const [vendorName, setVendorName] = useState(sp.get("vendorName") ?? "");
  const [labelName, setLabelName] = useState(sp.get("labelName") ?? "");
  const [vendorPartNo, setVendorPartNo] = useState(sp.get("vendorPartNo") ?? "");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // 从汇总表跳转时默认冻结筛选条件
  const [filterLocked, setFilterLocked] = useState(fromSummary);

  const queryParams = useMemo(() => ({
    vendorName: vendorName || undefined,
    labelName: labelName || undefined,
    vendorPartNo: vendorPartNo || undefined,
    page,
    pageSize: 50,
  }), [vendorName, labelName, vendorPartNo, page]);

  const { data: permission } = trpc.pkgWipInprocDetail.checkPermission.useQuery({ type: "view" });
  const { data: exportPermission } = trpc.pkgWipInprocDetail.checkPermission.useQuery({ type: "export" });
  const { data: filterOptions } = trpc.pkgWipInprocDetail.filterOptions.useQuery(
    undefined,
    { enabled: !!permission?.allowed }
  );
  const { data, isLoading, refetch } = trpc.pkgWipInprocDetail.query.useQuery(
    queryParams,
    { enabled: !!permission?.allowed }
  );

  // 表格容器 ref：用于自动为单元格注入 title 属性（悬停显示完整内容）
  const tableRef = useRef<HTMLDivElement>(null);
  useAutoTitles(tableRef, [data]);

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  async function handleExport() {
    if (!exportPermission?.allowed) {
      toast.error("无导出权限");
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (vendorName) params.set("vendorName", vendorName);
      if (labelName) params.set("labelName", labelName);
      if (vendorPartNo) params.set("vendorPartNo", vendorPartNo);
      const resp = await fetch(`/api/export/pkg-wip-inproc-detail?${params}`);
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const parts = ["封装厂在制品明细表", vendorName, labelName].filter(Boolean);
      a.download = `${parts.join("_")}.xlsx`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(`导出失败：${String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  if (!permission?.allowed) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        您没有查看此报表的权限，请联系管理员
      </div>
    );
  }

  const rows = data?.rows ?? [];

  const totalRow = rows.reduce(
    (acc, row) => ({
      die_attach: acc.die_attach + (Number(row.die_attach) || 0),
      wire_bond: acc.wire_bond + (Number(row.wire_bond) || 0),
      molding: acc.molding + (Number(row.molding) || 0),
      testing: acc.testing + (Number(row.testing) || 0),
      test_done: acc.test_done + (Number(row.test_done) || 0),
      total_wip: acc.total_wip + (Number((row as typeof row & { total_wip?: number }).total_wip) || 0),
    }),
    { die_attach: 0, wire_bond: 0, molding: 0, testing: 0, test_done: 0, total_wip: 0 }
  );

  const COL_COUNT = 12;

  return (
    <div ref={tableRef} className="flex flex-col h-full gap-3 p-4 report-page">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">封装厂在制品明细表</h1>
          {fromSummary && (
            <Badge className="bg-blue-100 text-blue-700 border-blue-300 gap-1 px-2 py-0.5 text-xs font-medium">
              <Filter size={11} />
              来自汇总表筛选
            </Badge>
          )}
          {fromSummary && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              onClick={() => {
                const backParams = new URLSearchParams();
                if (summaryLabelName) backParams.set("summaryLabelName", summaryLabelName);
                if (summaryVendorName) backParams.set("summaryVendorName", summaryVendorName);
                const qs = backParams.toString();
                navigate(`${backRoute}${qs ? `?${qs}` : ""}`);
              }}
            >
              ← 返回汇总表
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {fromSummary && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilterLocked(v => !v)}
              className={filterLocked ? "border-blue-400 text-blue-600 bg-blue-50 hover:bg-blue-100" : ""}
            >
              {filterLocked ? "解锁筛选" : "锁定筛选"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> 刷新
          </Button>
          {exportPermission?.allowed && (
            <Button size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="w-4 h-4 mr-1" />
              {exporting ? "导出中..." : "导出 Excel"}
            </Button>
          )}
        </div>
      </div>

      {/* 筛选栏 */}
      <div className={`flex flex-wrap gap-2 items-end bg-card border rounded-lg p-3 ${filterLocked ? "ring-1 ring-blue-300 bg-blue-50/30" : ""}`}>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">委外厂商</span>
          <Select
            value={vendorName || "__all__"}
            onValueChange={v => { if (!filterLocked) { setVendorName(v === "__all__" ? "" : v); setPage(1); } }}
            disabled={filterLocked}
          >
            <SelectTrigger className={`w-40 h-8 ${filterLocked ? "opacity-60 cursor-not-allowed" : ""}`}><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {filterOptions?.vendorNames?.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">标签品名</span>
          <Input
            value={labelName}
            onChange={e => { if (!filterLocked) { setLabelName(e.target.value); setPage(1); } }}
            placeholder="搜索..."
            className={`w-40 h-8 ${filterLocked ? "opacity-60 cursor-not-allowed" : ""}`}
            readOnly={filterLocked}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">供应商料号</span>
          <Input
            value={vendorPartNo}
            onChange={e => { if (!filterLocked) { setVendorPartNo(e.target.value); setPage(1); } }}
            placeholder="搜索..."
            className={`w-36 h-8 ${filterLocked ? "opacity-60 cursor-not-allowed" : ""}`}
            readOnly={filterLocked}
          />
        </div>
        <Button size="sm" className="h-8 mt-4" onClick={() => { setPage(1); refetch(); }}>
          <Search className="w-4 h-4 mr-1" /> 查询
        </Button>
      </div>

      {/* 数据统计 */}
      <div className="text-sm text-muted-foreground">
        共 <strong className="text-foreground">{data?.total ?? 0}</strong> 条记录
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <TableRow>
              <TableHead className="whitespace-nowrap">委外厂商</TableHead>
              <TableHead className="whitespace-nowrap">委外订单号</TableHead>
              <TableHead className="whitespace-nowrap">标签品名</TableHead>
              <TableHead className="whitespace-nowrap">供应商料号</TableHead>
              <TableHead className="whitespace-nowrap">批号</TableHead>
              <TableHead className="whitespace-nowrap text-right">装片</TableHead>
              <TableHead className="whitespace-nowrap text-right">焊线</TableHead>
              <TableHead className="whitespace-nowrap text-right">塑封</TableHead>
              <TableHead className="whitespace-nowrap text-right">测试</TableHead>
              <TableHead className="whitespace-nowrap text-right">测试后</TableHead>
              <TableHead className="whitespace-nowrap text-right font-bold text-primary">合计WIP数量</TableHead>
              <TableHead className="whitespace-nowrap">进度更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={COL_COUNT} className="text-center py-12 text-muted-foreground">加载中...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={COL_COUNT} className="text-center py-12 text-muted-foreground">暂无数据</TableCell></TableRow>
            ) : (
              <>
                {rows.map((row, i) => {
                  const rowAny = row as typeof row & { total_wip?: number };
                  return (
                    <TableRow key={i} className="hover:bg-muted/40">
                      <TableCell className="whitespace-nowrap">{row.vendor_name}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{row.order_no}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.label_name}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{row.vendor_part_no}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{row.batch_no}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(row.die_attach)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(row.wire_bond)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(row.molding)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(row.testing)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(row.test_done)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-semibold text-primary">{fmtTotal(rowAny.total_wip ?? 0)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{row.update_time}</TableCell>
                    </TableRow>
                  );
                })}
                {/* 合计行 */}
                {rows.length > 0 && (
                  <TableRow className="bg-muted/60 border-t-2 border-primary/20 font-bold">
                    <TableCell colSpan={5} className="text-primary text-xs font-bold">合计</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs">{fmtTotal(totalRow.die_attach)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs">{fmtTotal(totalRow.wire_bond)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs">{fmtTotal(totalRow.molding)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs">{fmtTotal(totalRow.testing)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs">{fmtTotal(totalRow.test_done)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs text-primary">{fmtTotal(totalRow.total_wip)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span className="text-muted-foreground">第 {page} / {totalPages} 页</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
      )}
    </div>
  );
}
