/**
 * 封装厂在制品汇总表 —— 报表插件
 *
 * 数据来源：v_dwd_order_agg (当日订单) LEFT JOIN v_dws_ab_wip_agg (DWS 层 argMax 聚合)
 * 与《封装厂WIP汇总表》的差异：
 *   - 仅看当天 (today()) 数据，不需要用户选择日期
 *   - WIP 来源于 DWS 层预聚合视图 v_dws_ab_wip_agg，带 update_time
 *   - 所有 WIP 字段使用 ifNull 包裹，避免 Nullable 列的 NULL 传播
 *   - 输出列包含每组最大 update_time
 */
import { z } from "zod";
import type { ReportPlugin } from "./_types";
import { type ReportDbClient, sqlToday, sqlCastStr, sqlGroupUniqArray, sqlArrayStringConcat, parseArrayResult } from "./_dbClient";

/** 获取服务器本地时区的当前日期字符串（yyyy-mm-dd），避免 UTC 偏移导致凌晨显示前一天 */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────
interface Row {
  label_name: string;
  vendor_part_no: string;
  /** 封装形式（来源 v_dwd_order，按 order_no+vendor_part_no 关联） */
  package_type: string;
  vendor_name: string;
  open_qty: number;
  unissued_qty: number;
  die_attach: number;
  wire_bond: number;
  molding: number;
  testing: number;
  test_done: number;
  /** 在制品总数 = 装片 + 焊线 + 塑封 + 测试 + 测试后 */
  wip_qty: number;
  update_time: string;
  /** 该组汇总的所有委外订单号（用于跳转委外订单明细表的 orderNos 列表） */
  order_nos?: string[];
}

interface Input {
  labelName?: string;
  vendorName?: string;
  packageType?: string;
  page?: number;
  pageSize?: number;
}

interface FilterOptions {
  labelNames: string[];
  vendorNames: string[];
  packageTypes: string[];
}

interface QueryReturn {
  rows: Row[];
  data: Row[];
  total: number;
  totalRow: Row;
}

interface ExportReturn {
  data: Row[];
  total: number;
  totalRow: Row;
}

// ─── SQL 工具 ────────────────────────────────────────────────────────────────
function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** 将 update_time 格式化为 yyyy-mm-dd；空值或 0000-00-00 / 1970-01-01 返回空串 */
function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = String(v).slice(0, 10);
  if (!d || d.startsWith("0000-00-00") || d === "1970-01-01") return "";
  return d;
}

/** 内层查询：单行粒度（订单 × 供应商料号），已做 NULL 安全化
 *  注：v_dwd_order_agg 未暴露 package_type，需再关联 v_dwd_order 补充；
 *      ClickHouse 18.16.1 单个 SELECT 仅支持一个 JOIN，故用嵌套子查询分两层关联 */
const INNER_SQL = (engine: ReportDbClient["engineType"]) => `
SELECT
    base.order_no        AS order_no,
    base.label_name      AS label_name,
    base.vendor_part_no  AS vendor_part_no,
    ifNull(pkg.package_type, '') AS package_type,
    base.vendor_name     AS vendor_name,
    base.open_qty        AS open_qty,
    base.unissued_qty    AS unissued_qty,
    base.die_attach      AS die_attach,
    base.wire_bond       AS wire_bond,
    base.molding         AS molding,
    base.testing         AS testing,
    base.test_done       AS test_done,
    base.wip_qty         AS wip_qty,
    base.update_time     AS update_time
FROM (
SELECT
    ord.order_no               AS order_no,
    ifNull(ord.label, '')          AS label_name,
    ifNull(ord.vendor_part_no, '') AS vendor_part_no,
    ifNull(ord.vendor_name, '')    AS vendor_name,
    ifNull(ord.open_qty, 0)  AS open_qty,
    (ifNull(ord.open_qty, 0)
     - ifNull(wip.die_attach, 0)
     - ifNull(wip.wire_bond, 0)
     - ifNull(wip.molding, 0)
     - ifNull(wip.testing, 0)
     - ifNull(wip.test_done, 0)) AS unissued_qty,
    ifNull(wip.die_attach, 0) AS die_attach,
    ifNull(wip.wire_bond, 0)  AS wire_bond,
    ifNull(wip.molding, 0)    AS molding,
    ifNull(wip.testing, 0)    AS testing,
    ifNull(wip.test_done, 0)  AS test_done,
    (ifNull(wip.die_attach, 0)
     + ifNull(wip.wire_bond, 0)
     + ifNull(wip.molding, 0)
     + ifNull(wip.testing, 0)
     + ifNull(wip.test_done, 0)) AS wip_qty,
    wip.update_time           AS update_time
FROM v_dwd_order_agg AS ord
LEFT JOIN v_dws_ab_wip_agg AS wip
       ON wip.order_no       = ord.order_no
      AND wip.vendor_part_no = ord.vendor_part_no
WHERE ord.date = ${sqlToday(engine)}
) AS base
LEFT JOIN (
  SELECT order_no, vendor_part_no, max(ifNull(package_type, '')) AS package_type
  FROM v_dwd_order
  WHERE date = ${sqlToday(engine)}
  GROUP BY order_no, vendor_part_no
) AS pkg
       ON pkg.order_no       = base.order_no
      AND pkg.vendor_part_no = base.vendor_part_no`;

function buildWhere(p: Input): string {
  const conds: string[] = [];
  if (p.labelName) conds.push(`lower(label_name) LIKE lower('%${esc(p.labelName)}%')`);
  if (p.vendorName) conds.push(`lower(vendor_name) LIKE lower('%${esc(p.vendorName)}%')`);
  if (p.packageType) conds.push(`lower(package_type) LIKE lower('%${esc(p.packageType)}%')`);
  return conds.length ? "WHERE " + conds.join(" AND ") : "";
}

function toRow(r: Record<string, unknown>): Row {
  let order_nos: string[] = [];
  const raw = r.order_nos;
  order_nos = parseArrayResult(raw);
  return {
    label_name: String(r.label_name ?? ""),
    vendor_part_no: String(r.vendor_part_no ?? ""),
    package_type: String(r.package_type ?? ""),
    vendor_name: String(r.vendor_name ?? ""),
    open_qty: Number(r.open_qty ?? 0),
    unissued_qty: Number(r.unissued_qty ?? 0),
    die_attach: Number(r.die_attach ?? 0),
    wire_bond: Number(r.wire_bond ?? 0),
    molding: Number(r.molding ?? 0),
    testing: Number(r.testing ?? 0),
    test_done: Number(r.test_done ?? 0),
    wip_qty: Number(r.wip_qty ?? 0),
    update_time: String(r.update_time ?? ""),
    order_nos,
  };
}

// ─── ClickHouse 查询 ─────────────────────────────────────────────────────────
async function queryData(client: ReportDbClient, input: Input): Promise<QueryReturn> {
  const { page = 1, pageSize = 20 } = input;
  const where = buildWhere(input);
  const offset = (page - 1) * pageSize;
  const engine = client.engineType;
  const innerSql = INNER_SQL(engine);

  const countSql = `
SELECT count(*) AS cnt
FROM (
  SELECT vendor_part_no, vendor_name
  FROM (${innerSql}) AS t
  ${where}
  GROUP BY vendor_part_no, vendor_name
) AS t2`;

  const dataSql = `
SELECT
    ${sqlArrayStringConcat(engine, sqlGroupUniqArray(engine, "label_name"), ",")} AS label_name,
    vendor_part_no, vendor_name,
    max(package_type) AS package_type,
    sum(open_qty)     AS open_qty,
    sum(unissued_qty) AS unissued_qty,
    sum(die_attach)   AS die_attach,
    sum(wire_bond)    AS wire_bond,
    sum(molding)      AS molding,
    sum(testing)      AS testing,
    sum(test_done)    AS test_done,
    sum(wip_qty)      AS wip_qty,
    ${sqlGroupUniqArray(engine, "order_no")} AS order_nos,
    ${sqlCastStr(engine, "max(update_time)")} AS update_time
FROM (
  SELECT * FROM (${innerSql}) AS t
  ${where}
) AS t2
GROUP BY vendor_part_no, vendor_name
ORDER BY vendor_name, vendor_part_no
LIMIT ${pageSize} OFFSET ${offset}`;

  const totalSql = `
SELECT
    sum(open_qty)     AS open_qty,
    sum(unissued_qty) AS unissued_qty,
    sum(die_attach)   AS die_attach,
    sum(wire_bond)    AS wire_bond,
    sum(molding)      AS molding,
    sum(testing)      AS testing,
    sum(test_done)    AS test_done,
    sum(wip_qty)      AS wip_qty,
    ${sqlCastStr(engine, "max(update_time)")} AS update_time
FROM (
  SELECT * FROM (${innerSql}) AS t
  ${where}
) AS t2`;

  const [countR, dataR, totalR] = await Promise.all([
    client.query<{ cnt: string }>(countSql),
    client.query<Record<string, unknown>>(dataSql),
    client.query<Record<string, string>>(totalSql),
  ]);

  const total = parseInt(countR[0]?.cnt ?? "0", 10);
  const rows = dataR.map(toRow);
  const t = totalR[0] ?? {};
  const totalRow: Row = {
    label_name: "合计",
    vendor_part_no: "",
    package_type: "",
    vendor_name: "",
    open_qty: Number(t.open_qty ?? 0),
    unissued_qty: Number(t.unissued_qty ?? 0),
    die_attach: Number(t.die_attach ?? 0),
    wire_bond: Number(t.wire_bond ?? 0),
    molding: Number(t.molding ?? 0),
    testing: Number(t.testing ?? 0),
    test_done: Number(t.test_done ?? 0),
    wip_qty: Number(t.wip_qty ?? 0),
    update_time: String(t.update_time ?? ""),
  };
  return { rows, data: rows, total, totalRow };
}

async function queryFilter(client: ReportDbClient): Promise<FilterOptions> {
  const engine = client.engineType;
  const innerSql = INNER_SQL(engine);
  const [labelR, vendorR, pkgR] = await Promise.all([
    client.query<{ label_name: string }>(
      `SELECT DISTINCT label_name FROM (${innerSql}) AS t WHERE label_name != '' ORDER BY label_name`,
    ),
    client.query<{ vendor_name: string }>(
      `SELECT DISTINCT vendor_name FROM (${innerSql}) AS t WHERE vendor_name != '' ORDER BY vendor_name`,
    ),
    client.query<{ package_type: string }>(
      `SELECT DISTINCT package_type FROM (${innerSql}) AS t WHERE package_type != '' ORDER BY package_type`,
    ),
  ]);
  return {
    labelNames: labelR.map((r) => r.label_name),
    vendorNames: vendorR.map((r) => r.vendor_name),
    packageTypes: pkgR.map((r) => r.package_type),
  };
}

async function queryExport(client: ReportDbClient, input: Input): Promise<ExportReturn> {
  const r = await queryData(client, { ...input, page: 1, pageSize: 999_999 });
  return { data: r.rows, total: r.total, totalRow: r.totalRow };
}

// ─── 插件定义 ────────────────────────────────────────────────────────────────
const plugin: ReportPlugin<
  Row,
  Input,
  void,
  FilterOptions,
  QueryReturn,
  ExportReturn
> = {
  meta: {
    code: "pkg_wip_inproc_summary",
    name: "封装厂在制品汇总表",
    category: "封装厂报表",
    description: "按当天订单聚合展示封装厂各工序在制品汇总（来源：v_dwd_order_agg × v_dws_ab_wip_agg，含最大更新时间）",
    route: "/reports/pkg-wip-inproc-summary",
    icon: "BarChart3",
    sortOrder: 2,
  },

  inputSchema: z.object({
    labelName: z.string().optional(),
    vendorName: z.string().optional(),
    packageType: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(20),
  }),
  exportInputSchema: z.object({
    labelName: z.string().optional(),
    vendorName: z.string().optional(),
    packageType: z.string().optional(),
  }),
  // 无参数
  filterOptionsInputSchema: undefined,

  query: queryData,
  filterOptions: (client) => queryFilter(client),
  exportQuery: queryExport,

  emptyQueryResult: {
    rows: [],
    data: [],
    total: 0,
    totalRow: {
      label_name: "合计",
      vendor_part_no: "",
      package_type: "",
      vendor_name: "",
      open_qty: 0,
      unissued_qty: 0,
      die_attach: 0,
      wire_bond: 0,
      molding: 0,
      testing: 0,
      test_done: 0,
      wip_qty: 0,
      update_time: "",
    },
  },
  emptyFilterOptions: { labelNames: [], vendorNames: [], packageTypes: [] },

  rowsForExcel: (exported) => exported.data,

  excel: {
    sheetName: "封装厂在制品汇总表",
    title: () => `封装厂在制品汇总表  ${localToday()}`,
    filenameParts: (input) => {
      const today = localToday();
      const parts = ["封装厂在制品汇总表", today];
      if (input.vendorName) parts.push(input.vendorName);
      else if (input.labelName) parts.push(input.labelName);
      return parts;
    },
    leftAlignCols: 4,
    columns: [
      { header: "标签品名",   width: 28, value: (r) => r.label_name },
      { header: "供应商料号", width: 18, value: (r) => r.vendor_part_no },
      { header: "封装形式",   width: 14, value: (r) => r.package_type },
      { header: "供应商",     width: 18, value: (r) => r.vendor_name },
      { header: "未回货数量", width: 12, value: (r) => r.open_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.open_qty) || 0), 0) },
      { header: "未投数量",   width: 12, value: (r) => r.unissued_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.unissued_qty) || 0), 0) },
      { header: "装片",       width: 10, value: (r) => r.die_attach,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.die_attach) || 0), 0) },
      { header: "焊线",       width: 10, value: (r) => r.wire_bond,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.wire_bond) || 0), 0) },
      { header: "塑封",       width: 10, value: (r) => r.molding,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.molding) || 0), 0) },
      { header: "测试",       width: 10, value: (r) => r.testing,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.testing) || 0), 0) },
      { header: "测试后",     width: 12, value: (r) => r.test_done,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.test_done) || 0), 0) },
      { header: "在制品总数", width: 14, value: (r) => r.wip_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.wip_qty) || 0), 0) },
      { header: "更新时间",   width: 14, value: (r) => fmtDate(r.update_time) },
    ],
  },
};

export default plugin;
