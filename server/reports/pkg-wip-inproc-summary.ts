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
import type { ClickHouseClient } from "@clickhouse/client";
import type { ReportPlugin } from "./_types";

// ─── 类型定义 ────────────────────────────────────────────────────────────────
interface Row {
  label_name: string;
  vendor_part_no: string;
  vendor_name: string;
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
  page?: number;
  pageSize?: number;
}

interface FilterOptions {
  labelNames: string[];
  vendorNames: string[];
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

/** 内层查询：单行粒度（订单 × 供应商料号），已做 NULL 安全化 */
const INNER_SQL = `
SELECT
    ord.order_no               AS order_no,
    ifNull(ord.label, '')          AS label_name,
    ifNull(ord.vendor_part_no, '') AS vendor_part_no,
    ifNull(ord.vendor_name, '')    AS vendor_name,
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
WHERE ord.date = today()`;

function buildWhere(p: Input): string {
  const conds: string[] = ["1 = 1"];
  if (p.labelName) conds.push(`lower(label_name) LIKE lower('%${esc(p.labelName)}%')`);
  if (p.vendorName) conds.push(`lower(vendor_name) LIKE lower('%${esc(p.vendorName)}%')`);
  return conds.join(" AND ");
}

function toRow(r: Record<string, unknown>): Row {
  let order_nos: string[] = [];
  const raw = r.order_nos;
  if (Array.isArray(raw)) order_nos = raw.map(String);
  else if (typeof raw === "string" && raw.startsWith("[")) {
    try { order_nos = JSON.parse(raw); } catch { order_nos = []; }
  }
  return {
    label_name: String(r.label_name ?? ""),
    vendor_part_no: String(r.vendor_part_no ?? ""),
    vendor_name: String(r.vendor_name ?? ""),
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
async function queryData(client: ClickHouseClient, input: Input): Promise<QueryReturn> {
  const { page = 1, pageSize = 20 } = input;
  const where = buildWhere(input);
  const offset = (page - 1) * pageSize;

  const countSql = `
SELECT count() AS cnt
FROM (
  SELECT vendor_part_no, vendor_name
  FROM (${INNER_SQL})
  WHERE ${where}
  GROUP BY vendor_part_no, vendor_name
)`;

  const dataSql = `
SELECT
    arrayStringConcat(groupUniqArray(label_name), ',') AS label_name,
    vendor_part_no, vendor_name,
    sum(unissued_qty) AS unissued_qty,
    sum(die_attach)   AS die_attach,
    sum(wire_bond)    AS wire_bond,
    sum(molding)      AS molding,
    sum(testing)      AS testing,
    sum(test_done)    AS test_done,
    sum(wip_qty)      AS wip_qty,
    groupUniqArray(order_no) AS order_nos,
    toString(max(update_time)) AS update_time
FROM (${INNER_SQL})
WHERE ${where}
GROUP BY vendor_part_no, vendor_name
ORDER BY vendor_name, vendor_part_no
LIMIT ${pageSize} OFFSET ${offset}`;

  const totalSql = `
SELECT
    sum(unissued_qty) AS unissued_qty,
    sum(die_attach)   AS die_attach,
    sum(wire_bond)    AS wire_bond,
    sum(molding)      AS molding,
    sum(testing)      AS testing,
    sum(test_done)    AS test_done,
    sum(wip_qty)      AS wip_qty,
    toString(max(update_time)) AS update_time
FROM (${INNER_SQL})
WHERE ${where}`;

  const [countR, dataR, totalR] = await Promise.all([
    client.query({ query: countSql, format: "JSONEachRow" }).then((r) => r.json<{ cnt: string }>()),
    client.query({ query: dataSql,  format: "JSONEachRow" }).then((r) => r.json<Record<string, unknown>>()),
    client.query({ query: totalSql, format: "JSONEachRow" }).then((r) => r.json<Record<string, string>>()),
  ]);

  const total = parseInt(countR[0]?.cnt ?? "0", 10);
  const rows = dataR.map(toRow);
  const t = totalR[0] ?? {};
  const totalRow: Row = {
    label_name: "合计",
    vendor_part_no: "",
    vendor_name: "",
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

async function queryFilter(client: ClickHouseClient): Promise<FilterOptions> {
  const [labelR, vendorR] = await Promise.all([
    client.query({
      query: `SELECT DISTINCT label_name FROM (${INNER_SQL}) WHERE label_name != '' ORDER BY label_name`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ label_name: string }>()),
    client.query({
      query: `SELECT DISTINCT vendor_name FROM (${INNER_SQL}) WHERE vendor_name != '' ORDER BY vendor_name`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ vendor_name: string }>()),
  ]);
  return {
    labelNames: labelR.map((r) => r.label_name),
    vendorNames: vendorR.map((r) => r.vendor_name),
  };
}

async function queryExport(client: ClickHouseClient, input: Input): Promise<ExportReturn> {
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
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(20),
  }),
  exportInputSchema: z.object({
    labelName: z.string().optional(),
    vendorName: z.string().optional(),
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
      vendor_name: "",
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
  emptyFilterOptions: { labelNames: [], vendorNames: [] },

  rowsForExcel: (exported) => exported.data,

  excel: {
    sheetName: "封装厂在制品汇总表",
    title: () => `封装厂在制品汇总表  ${new Date().toISOString().slice(0, 10)}`,
    filenameParts: (input) => {
      const today = new Date().toISOString().slice(0, 10);
      const parts = ["封装厂在制品汇总表", today];
      if (input.vendorName) parts.push(input.vendorName);
      else if (input.labelName) parts.push(input.labelName);
      return parts;
    },
    leftAlignCols: 3,
    columns: [
      { header: "标签品名",   width: 28, value: (r) => r.label_name },
      { header: "供应商料号", width: 18, value: (r) => r.vendor_part_no },
      { header: "供应商",     width: 18, value: (r) => r.vendor_name },
      { header: "未回货数量", width: 12, value: (r) => r.unissued_qty,
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
