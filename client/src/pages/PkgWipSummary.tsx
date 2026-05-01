import { trpc } from "@/lib/trpc";
import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAutoTitles } from "@/hooks/useAutoTitles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Download, Search, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, X, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function formatNum(n: number) {
  return n.toLocaleString("zh-CN");
}

// 0值显示为空白，非0值正常格式化
function fmtCell(n: number) {
  return n === 0 ? "" : n.toLocaleString("zh-CN");
}

// ─── 可输入模糊搜索 Combobox ───────────────────────────────────────────────
interface FuzzyComboboxProps {
  options: string[];
  value: string;          // "" 表示"全部"
  onChange: (v: string) => void;
  placeholder?: string;
  emptyText?: string;
}

function FuzzyCombobox({ options, value, onChange, placeholder = "全部", emptyText = "无匹配项" }: FuzzyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 当外部 value 变化时同步输入框显示
  useEffect(() => {
    setInputVal(value);
  }, [value]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // 如果输入内容不在选项中，且不是清空，则恢复为上次选中值
        if (inputVal !== "" && !options.includes(inputVal)) {
          setInputVal(value);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [inputVal, value, options]);

  // 实时模糊过滤
  const filtered = inputVal.trim() === ""
    ? options
    : options.filter((o) => o.toLowerCase().includes(inputVal.toLowerCase()));

  const handleSelect = (opt: string) => {
    onChange(opt);
    setInputVal(opt);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setInputVal("");
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputVal(e.target.value);
    setOpen(true);
  };

  const handleInputFocus = () => {
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setInputVal(value);
    }
    if (e.key === "Enter" && filtered.length > 0) {
      handleSelect(filtered[0]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Input
          ref={inputRef}
          value={inputVal}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-9 text-sm pr-14"
          autoComplete="off"
        />
        <div className="absolute right-0 flex items-center pr-1 gap-0.5">
          {(inputVal !== "") && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { setOpen((o) => !o); inputRef.current?.focus(); }}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            <ChevronsUpDown size={13} />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          <div className="max-h-52 overflow-y-auto py-1">
            {/* "全部"选项始终显示在顶部 */}
            <button
              type="button"
              onClick={() => handleSelect("")}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors",
                value === "" && "bg-primary/10 font-medium text-primary"
              )}
            >
              全部
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">{emptyText}</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors truncate",
                    value === opt && "bg-primary/10 font-medium text-primary"
                  )}
                  title={opt}
                >
                  {/* 高亮匹配部分 */}
                  {inputVal.trim() ? highlightMatch(opt, inputVal) : opt}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 高亮匹配文字
function highlightMatch(text: string, keyword: string) {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded-sm px-0.5">{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </span>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

export default function PkgWipSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const [, navigate] = useLocation();

  // 从 URL 读取返回时恢复的筛选条件
  const initParams = new URLSearchParams(window.location.search);
  const initDate = initParams.get("summaryDate") || today;
  const initLabelName = initParams.get("summaryLabelName") || "";
  const initVendorName = initParams.get("summaryVendorName") || "";

  const [date, setDate] = useState(initDate);
  const [labelName, setLabelName] = useState(initLabelName);   // "" = 全部
  const [vendorName, setVendorName] = useState(initVendorName); // "" = 全部
  const [pageSize, setPageSize] = useState(20);

  const [queryParams, setQueryParams] = useState({
    date: initDate, labelName: initLabelName, vendorName: initVendorName, page: 1, pageSize: 20,
  });

  const { data: viewPerm } = trpc.pkgWipSummary.checkPermission.useQuery({ type: "view" });
  const { data: exportPerm } = trpc.pkgWipSummary.checkPermission.useQuery({ type: "export" });

  // filterOptions 跟随日期实时更新，为 Combobox 提供候选项
  const { data: filterOpts } = trpc.pkgWipSummary.filterOptions.useQuery(
    { date },
    { enabled: !!viewPerm?.allowed }
  );

  const { data, isLoading, isFetching, error, refetch } = trpc.pkgWipSummary.query.useQuery(
    queryParams,
    { enabled: !!viewPerm?.allowed }
  );

  // 表格容器 ref：用于自动为单元格注入 title 属性（悬停显示完整内容）
  const tableRef = useRef<HTMLDivElement>(null);
  useAutoTitles(tableRef, [data]);

  // 导出功能改为调用服务端接口，避免在浏览器端加载 exceljs

  const handleSearch = useCallback(() => {
    setQueryParams({ date, labelName, vendorName, page: 1, pageSize });
  }, [date, labelName, vendorName, pageSize]);

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
        date: queryParams.date,
        ...(queryParams.labelName ? { labelName: queryParams.labelName } : {}),
        ...(queryParams.vendorName ? { vendorName: queryParams.vendorName } : {}),
      });
      const resp = await fetch(`/api/export/pkg-wip-summary?${params.toString()}`);
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
      // 文件名加入筛选条件
      const nameParts = ["封装厂WIP汇总表", queryParams.date];
      if (queryParams.vendorName) nameParts.push(queryParams.vendorName);
      else if (queryParams.labelName) nameParts.push(queryParams.labelName);
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

  return (
    <div ref={tableRef} className="p-6 report-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">封装厂WIP汇总表</h1>
          <p className="text-xs text-muted-foreground mt-0.5">展示封装厂各工序在制品（WIP）汇总数据</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">查询日期</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              标签品名
              <span className="ml-1 text-muted-foreground/60 font-normal">（可输入搜索）</span>
            </Label>
            <FuzzyCombobox
              options={filterOpts?.labelNames ?? []}
              value={labelName}
              onChange={setLabelName}
              placeholder="全部（可输入筛选）"
              emptyText="无匹配的标签品名"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              供应商
              <span className="ml-1 text-muted-foreground/60 font-normal">（可输入搜索）</span>
            </Label>
            <FuzzyCombobox
              options={filterOpts?.vendorNames ?? []}
              value={vendorName}
              onChange={setVendorName}
              placeholder="全部（可输入筛选）"
              emptyText="无匹配的供应商"
            />
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
                共 <span className="font-semibold text-foreground">{data.total}</span> 条记录
              </span>
            )}
            {(isFetching && !isLoading) && (
              <Badge variant="secondary" className="text-xs">更新中...</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">每页</span>
            <Select value={String(queryParams.pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">条</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                {["标签品名","供应商料号","供应商","未回货数量","未投数量","装片","焊线","塑封","测试","测试后-入库","合计WIP数量"].map((h, i) => (
                  <TableHead key={h} className={cn("text-xs font-semibold text-foreground whitespace-nowrap px-3 py-3", i >= 3 && "text-right")}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <TableCell key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    <AlertCircle size={24} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">加载失败，请重试</p>
                  </TableCell>
                </TableRow>
              ) : data?.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground text-sm">暂无数据</TableCell>
                </TableRow>
              ) : (
                <>
                  {data?.data.map((row, idx) => {
                    const rowAny = row as typeof row & { open_qty?: number; order_nos?: string[] };
                    // 汇总表当前筛选条件，返回时用于恢复
                    const summaryBack = new URLSearchParams({
                      ...(queryParams.date ? { summaryDate: queryParams.date } : {}),
                      ...(queryParams.labelName ? { summaryLabelName: queryParams.labelName } : {}),
                      ...(queryParams.vendorName ? { summaryVendorName: queryParams.vendorName } : {}),
                    }).toString();
                    // WIP明细表跳转链接
                    const wipDetailParams = new URLSearchParams({
                      date: queryParams.date,
                      ...(row.label_name ? { labelName: row.label_name } : {}),
                      ...(row.vendor_part_no ? { vendorPartNo: row.vendor_part_no } : {}),
                      ...(row.vendor_name ? { vendorName: row.vendor_name } : {}),
                      fromSummary: "1",
                      ...(queryParams.date ? { summaryDate: queryParams.date } : {}),
                      ...(queryParams.labelName ? { summaryLabelName: queryParams.labelName } : {}),
                      ...(queryParams.vendorName ? { summaryVendorName: queryParams.vendorName } : {}),
                    }).toString();
                    // 委外订单明细表跳转链接：附加 orderNos 列表和 summary* 参数
                    const outsourceBase = new URLSearchParams({
                      date: queryParams.date,
                      ...(row.label_name ? { labelName: row.label_name } : {}),
                      ...(row.vendor_part_no ? { vendorPartNo: row.vendor_part_no } : {}),
                      ...(row.vendor_name ? { vendorName: row.vendor_name } : {}),
                      fromSummary: "1",
                      ...(queryParams.date ? { summaryDate: queryParams.date } : {}),
                      ...(queryParams.labelName ? { summaryLabelName: queryParams.labelName } : {}),
                      ...(queryParams.vendorName ? { summaryVendorName: queryParams.vendorName } : {}),
                    });
                    // 将 order_nos 数组逐个附加为多个 orderNos 参数
                    if (rowAny.order_nos && rowAny.order_nos.length > 0) {
                      rowAny.order_nos.forEach((no) => outsourceBase.append("orderNos", no));
                    }
                    const outsourceParams = outsourceBase.toString();
                    return (
                    <TableRow key={idx} className={cn("transition-colors", idx % 2 === 0 ? "bg-white" : "bg-[oklch(0.975_0.005_252)]")}>
                      <TableCell className="px-3 py-2.5 font-medium text-xs">{row.label_name}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.vendor_part_no}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs">{row.vendor_name}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">
                        {rowAny.open_qty ? (
                          <button type="button" className="text-blue-600 underline hover:text-blue-400 transition-colors cursor-pointer" onClick={() => navigate(`/reports/outsource-order-detail?${outsourceParams}`)}>
                            {fmtCell(rowAny.open_qty)}
                          </button>
                        ) : ""}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.unissued_qty)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.die_attach)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.wire_bond)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.molding)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.testing)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.test_done)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs font-semibold">
                        {row.wip_qty !== 0 ? (
                          <button type="button" className="text-primary underline hover:text-primary/70 transition-colors cursor-pointer" onClick={() => navigate(`/reports/pkg-wip-detail?${wipDetailParams}`)}>
                            {fmtCell(row.wip_qty)}
                          </button>
                        ) : ""}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {data?.totalRow && (
                    <TableRow className="bg-[oklch(0.93_0.02_252)] border-t-2 border-primary/20">
                      <TableCell className="px-3 py-3 font-bold text-xs text-primary" colSpan={3}>合计</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell((data.totalRow as typeof data.totalRow & { open_qty?: number }).open_qty ?? 0)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell(data.totalRow.unissued_qty)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell(data.totalRow.die_attach)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell(data.totalRow.wire_bond)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell(data.totalRow.molding)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell(data.totalRow.testing)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">{fmtCell(data.totalRow.test_done)}</TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold text-primary">{fmtCell(data.totalRow.wip_qty)}</TableCell>
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
