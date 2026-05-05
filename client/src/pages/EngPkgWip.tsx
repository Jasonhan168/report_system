import { trpc } from "@/lib/trpc";
import { useState, useCallback, useRef } from "react";
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
import {
  Download, Search, RefreshCw, ChevronLeft, ChevronRight,
  AlertCircle, X, ChevronsUpDown,
} from "lucide-react";
import { cn, localToday } from "@/lib/utils";
import { useEffect } from "react";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 数值格式化：0 值显示为空 */
function fmtCell(n: number) {
  return n === 0 ? "" : n.toLocaleString("zh-CN");
}

/** 将 update_time 截取到 yyyy-mm-dd HH:MM:SS；无效时间返回空串 */
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v).slice(0, 19);
  if (!s || s.startsWith("0000-00-00") || s.startsWith("1970-01-01 00:00:00")) return "";
  return s;
}

/** 下单日期截取到 yyyy-mm-dd */
function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

/** 计算距交期剩余天数（负数表示已拖期，null 表示无交期） */
function daysUntilEdd(edd: string | null | undefined): number | null {
  if (!edd) return null;
  const eddDate = new Date(edd);
  if (isNaN(eddDate.getTime())) return null;
  const today = new Date(localToday());
  return Math.floor((eddDate.getTime() - today.getTime()) / 86400000);
}

/** 返回行高亮样式：已拖期=红色，临近交期(<=5天)=琥珀色 */
function rowHighlight(edd: string | null | undefined): string {
  const remaining = daysUntilEdd(edd);
  if (remaining === null) return "";
  if (remaining < 0)  return "bg-red-50 hover:bg-red-100";
  if (remaining <= 5) return "bg-amber-50 hover:bg-amber-100";
  return "";
}

// ─── 可输入模糊搜索 Combobox ───────────────────────────────────────────────
interface FuzzyComboboxProps {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  emptyText?: string;
}

function FuzzyCombobox({
  options,
  value,
  onChange,
  placeholder = "全部",
  emptyText = "无匹配项",
}: FuzzyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setInputVal(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (inputVal !== "" && !options.includes(inputVal)) {
          setInputVal(value);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [inputVal, value, options]);

  const filtered =
    inputVal.trim() === ""
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
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-9 text-sm pr-14"
          autoComplete="off"
        />
        <div className="absolute right-0 flex items-center pr-1 gap-0.5">
          {inputVal !== "" && (
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
            <button
              type="button"
              onClick={() => handleSelect("")}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors",
                value === "" && "bg-primary/10 font-medium text-primary",
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
                    value === opt && "bg-primary/10 font-medium text-primary",
                  )}
                  title={opt}
                >
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

function highlightMatch(text: string, keyword: string) {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded-sm px-0.5">
        {text.slice(idx, idx + keyword.length)}
      </mark>
      {text.slice(idx + keyword.length)}
    </span>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

// 表头定义（含预计交期和拖期天数）
const HEADERS = [
  "委外订单号", "下单日期", "预计交期", "加工类型", "委外厂商",
  "ERP料号", "Lot No.", "标签品名", "供应商料号", "封装形式",
  "下单数量", "未回货数量", "装片前", "装片", "焊线", "塑封", "测试", "测试后",
  "更新时间", "拖期天数",
];
const COL_COUNT = HEADERS.length;
// 数值列（从第11列起，索引10~17）
const NUM_COL_START = 10;
const NUM_COL_END   = 17;

export default function EngPkgWip() {
  const [vendorName,  setVendorName]  = useState("");
  const [label,       setLabel]       = useState("");
  const [packageType, setPackageType] = useState("");
  const [pageSize,    setPageSize]    = useState(20);

  const [queryParams, setQueryParams] = useState({
    vendorName: "", label: "", packageType: "", page: 1, pageSize: 20,
  });

  const { data: viewPerm }   = trpc.engPkgWip.checkPermission.useQuery({ type: "view" });
  const { data: exportPerm } = trpc.engPkgWip.checkPermission.useQuery({ type: "export" });

  const { data: filterOpts } = trpc.engPkgWip.filterOptions.useQuery(
    undefined,
    { enabled: !!viewPerm?.allowed },
  );

  const { data, isLoading, isFetching, error, refetch } = trpc.engPkgWip.query.useQuery(
    queryParams,
    { enabled: !!viewPerm?.allowed },
  );

  const tableRef = useRef<HTMLDivElement>(null);
  useAutoTitles(tableRef, [data]);

  const handleSearch = useCallback(() => {
    setQueryParams({ vendorName, label, packageType, page: 1, pageSize });
  }, [vendorName, label, packageType, pageSize]);

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
        ...(queryParams.vendorName  ? { vendorName:  queryParams.vendorName }  : {}),
        ...(queryParams.label       ? { label:       queryParams.label }       : {}),
        ...(queryParams.packageType ? { packageType: queryParams.packageType } : {}),
      });
      const resp = await fetch(`/api/export/eng-pkg-wip?${params.toString()}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "导出失败" }));
        toast.error((err as { error?: string }).error || "导出失败，请重试");
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
      const today = localToday();
      const nameParts = ["工程批封装在制品报表", today];
      if (queryParams.vendorName)  nameParts.push(queryParams.vendorName);
      else if (queryParams.label)  nameParts.push(queryParams.label);
      else if (queryParams.packageType) nameParts.push(queryParams.packageType);
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
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">工程批封装在制品报表</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            仅展示当天工程批（production_type=2:工程）各工序在制品明细，未结案且回货率 &lt; 98%
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
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
          {/* 委外厂商 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              委外厂商
              <span className="ml-1 text-muted-foreground/60 font-normal">（可输入搜索）</span>
            </Label>
            <FuzzyCombobox
              options={filterOpts?.vendorNames ?? []}
              value={vendorName}
              onChange={setVendorName}
              placeholder="全部（可输入筛选）"
              emptyText="无匹配的委外厂商"
            />
          </div>

          {/* 标签品名 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              标签品名
              <span className="ml-1 text-muted-foreground/60 font-normal">（可输入搜索）</span>
            </Label>
            <FuzzyCombobox
              options={filterOpts?.labels ?? []}
              value={label}
              onChange={setLabel}
              placeholder="全部（可输入筛选）"
              emptyText="无匹配的标签品名"
            />
          </div>

          {/* 封装形式 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              封装形式
              <span className="ml-1 text-muted-foreground/60 font-normal">（可输入搜索）</span>
            </Label>
            <FuzzyCombobox
              options={filterOpts?.packageTypes ?? []}
              value={packageType}
              onChange={setPackageType}
              placeholder="全部（可输入筛选）"
              emptyText="无匹配的封装形式"
            />
          </div>

          {/* 查询按钮 */}
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
        {/* 表格工具栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground">
                共 <span className="font-semibold text-foreground">{data.total}</span> 条记录
              </span>
            )}
            {isFetching && !isLoading && (
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

        {/* 表格主体 */}
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <Table className="text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                {HEADERS.map((h, i) => (
                  <TableHead
                    key={h}
                    className={cn(
                      "text-xs font-semibold text-foreground whitespace-nowrap px-3 py-3 bg-secondary/50",
                      i >= NUM_COL_START && i <= NUM_COL_END && "text-right",
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
                    {Array.from({ length: COL_COUNT }).map((_, j) => (
                      <TableCell key={j} className="px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={COL_COUNT} className="text-center py-12 text-muted-foreground">
                    <AlertCircle size={24} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">加载失败，请重试</p>
                  </TableCell>
                </TableRow>
              ) : data?.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COL_COUNT} className="text-center py-12 text-muted-foreground text-sm">
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data?.data.map((row, idx) => {
                    const highlight = rowHighlight(row.edd);
                    return (
                    <TableRow
                      key={idx}
                      className={cn(
                        "transition-colors",
                        highlight
                          ? highlight
                          : idx % 2 === 0 ? "bg-white" : "bg-[oklch(0.975_0.005_252)]",
                      )}
                    >
                      <TableCell className="px-3 py-2.5 text-xs font-medium">{row.order_no}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.order_date)}
                      </TableCell>
                      {/* 预计交期：已拖期红色，临近交期琶珀色 */}
                      <TableCell className={cn(
                        "px-3 py-2.5 text-xs whitespace-nowrap",
                        (() => {
                          const r = daysUntilEdd(row.edd);
                          if (r === null) return "text-muted-foreground";
                          if (r < 0)  return "text-red-600 font-semibold";
                          if (r <= 5) return "text-amber-600 font-semibold";
                          return "text-muted-foreground";
                        })()
                      )}>
                        {fmtDate(row.edd)}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs">{row.process_type}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs">{row.vendor_name}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.part_no}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs">{row.lot_no}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs font-medium">{row.label}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.vendor_part_no}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs">{row.package_type}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.order_qty)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.open_qty)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.before_attach)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.die_attach)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.wire_bond)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.molding)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.testing)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right text-xs">{fmtCell(row.test_done)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDateTime(row.update_time)}
                      </TableCell>
                      {/* 拖期天数：>0 才显示，红色加粗 */}
                      <TableCell className="px-3 py-2.5 text-right text-xs">
                        {row.overdue_days > 0
                          ? <span className="text-red-600 font-semibold">{row.overdue_days}</span>
                          : ""}
                      </TableCell>
                    </TableRow>
                    );
                  })}

                  {/* 合计行 */}
                  {data?.totalRow && (
                    <TableRow className="bg-[oklch(0.93_0.02_252)] border-t-2 border-primary/20">
                      <TableCell className="px-3 py-3 font-bold text-xs text-primary" colSpan={6}>
                        合计
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs font-bold text-primary" colSpan={4} />
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.order_qty)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.open_qty)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.before_attach)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.die_attach)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.wire_bond)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.molding)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.testing)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-xs font-bold">
                        {fmtCell(data.totalRow.test_done)}
                      </TableCell>
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
            <span className="text-xs text-muted-foreground">
              第 {queryParams.page} / {totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={queryParams.page <= 1}
                onClick={() => handlePageChange(queryParams.page - 1)}
              >
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
                  <Button
                    key={p}
                    variant={p === queryParams.page ? "default" : "outline"}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => handlePageChange(p)}
                  >
                    {p}
                  </Button>
                );
              })}
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={queryParams.page >= totalPages}
                onClick={() => handlePageChange(queryParams.page + 1)}
              >
                <ChevronRight size={13} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
