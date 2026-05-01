/**
 * 封装厂WIP汇总表 —— 报表插件
 *
 * 数据来源：v_dwd_order_agg LEFT JOIN v_dwd_ab_wip_agg
 * 特点：
 *   - 需要 mock 演示数据（未配 ClickHouse 时）
 *   - 导出带合计行（不受分页影响，后端单独聚合）
 */
import { z } from "zod";
import type { ClickHouseClient } from "@clickhouse/client";
import { generateMockWipData, generateMockFilterOptions, type WipRecord } from "../mockData";
import type { ReportPlugin, QueryResult } from "./_types";

// ─── 输入 / 返回类型 ─────────────────────────────────────────────────────────
interface SummaryInput {
  date: string;
  labelName?: string;
  vendorName?: string;
  page?: number;
  pageSize?: number;
}
interface SummaryFilterInput {
  date: string;
}
interface SummaryFilterOptions {
  labelNames: string[];
  vendorNames: string[];
}
/** query 返回：含 totalRow 的扩展结构（同时提供 rows/data 两个字段兼容前端） */
interface SummaryQueryReturn {
  rows: WipRecord[];
  data: WipRecord[];
  total: number;
  totalRow: WipRecord;
}
/** export 返回：含 data + totalRow */
interface SummaryExportReturn {
  data: WipRecord[];
  total: number;
  totalRow: WipRecord;
}

// ─── SQL 工具 ─────────────────────────────────────────────────────────────────
function escStr(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const INNER_SQL = `
SELECT
    ord.date,
    ord.order_no,
    ord.label as label_name,
    ord.vendor_part_no,
    ord.vendor_name,
    ((((ord.open_qty - wip.die_attach) - wip.wire_bond) - wip.molding) - wip.testing) - wip.test_done AS unissued_qty,
    ord.open_qty,
    wip.die_attach,
    wip.wire_bond,
    wip.molding,
    wip.testing,
    wip.test_done,
    (((wip.die_attach + wip.wire_bond) + wip.molding) + wip.testing) + wip.test_done AS wip_qty
FROM v_dwd_order_agg AS ord
LEFT JOIN v_dwd_ab_wip_agg AS wip
    ON  wip.date           = ord.date
    AND wip.order_no       = ord.order_no
    AND wip.vendor_part_no = ord.vendor_part_no`;

function buildWhere(p: SummaryInput): string {
  const conds: string[] = [`date = '${escStr(p.date)}'`];
  if (p.labelName) conds.push(`lower(label_name) LIKE lower('%${escStr(p.labelName)}%')`);
  if (p.vendorName) conds.push(`lower(vendor_name) LIKE lower('%${escStr(p.vendorName)}%')`);
  return conds.join(" AND ");
}

function toRec(row: Record<string, unknown>): WipRecord {
  let order_nos: string[] = [];
  const raw = row.order_nos;
  if (Array.isArray(raw)) order_nos = raw.map(String);
  else if (typeof raw === "string" && raw.startsWith("[")) {
    try { order_nos = JSON.parse(raw); } catch { order_nos = []; }
  }
  return {
    label_name: String(row.label_name ?? ""),
    vendor_part_no: String(row.vendor_part_no ?? ""),
    vendor_name: String(row.vendor_name ?? ""),
    unissued_qty: Number(row.unissued_qty ?? 0),
    open_qty: Number(row.open_qty ?? 0),
    die_attach: Number(row.die_attach ?? 0),
    wire_bond: Number(row.wire_bond ?? 0),
    molding: Number(row.molding ?? 0),
    testing: Number(row.testing ?? 0),
    test_done: Number(row.test_done ?? 0),
    wip_qty: Number(row.wip_qty ?? 0),
    order_nos,
  };
}

// ─── ClickHouse 查询 ─────────────────────────────────────────────────────────
async function queryData(client: ClickHouseClient, input: SummaryInput): Promise<SummaryQueryReturn> {
  const { page = 1, pageSize = 20 } = input;
  const where = buildWhere(input);
  const offset = (page - 1) * pageSize;

  const countSql = `
SELECT count() AS cnt
FROM (
  SELECT label_name, vendor_part_no, vendor_name
  FROM (${INNER_SQL})
  WHERE ${where}
  GROUP BY label_name, vendor_part_no, vendor_name
)`;
  const dataSql = `
SELECT
    label_name, vendor_part_no, vendor_name,
    sum(unissued_qty) AS unissued_qty,
    sum(open_qty)     AS open_qty,
    sum(die_attach)   AS die_attach,
    sum(wire_bond)    AS wire_bond,
    sum(molding)      AS molding,
    sum(testing)      AS testing,
    sum(test_done)    AS test_done,
    sum(wip_qty)      AS wip_qty,
    groupArray(order_no) AS order_nos
FROM (${INNER_SQL})
WHERE ${where}
GROUP BY label_name, vendor_part_no, vendor_name
ORDER BY label_name, vendor_name
LIMIT ${pageSize} OFFSET ${offset}`;
  const totalSql = `
SELECT
    sum(unissued_qty) AS unissued_qty,
    sum(open_qty)     AS open_qty,
    sum(die_attach)   AS die_attach,
    sum(wire_bond)    AS wire_bond,
    sum(molding)      AS molding,
    sum(testing)      AS testing,
    sum(test_done)    AS test_done,
    sum(wip_qty)      AS wip_qty
FROM (${INNER_SQL})
WHERE ${where}`;

  const [countR, dataR, totalR] = await Promise.all([
    client.query({ query: countSql, format: "JSONEachRow" }).then((r) => r.json<{ cnt: string }>()),
    client.query({ query: dataSql, format: "JSONEachRow" }).then((r) => r.json<Record<string, unknown>>()),
    client.query({ query: totalSql, format: "JSONEachRow" }).then((r) => r.json<Record<string, string>>()),
  ]);
  const total = parseInt(countR[0]?.cnt ?? "0", 10);
  const rows = dataR.map(toRec);
  const t = totalR[0] ?? {};
  const totalRow: WipRecord = {
    label_name: "合计", vendor_part_no: "", vendor_name: "",
    unissued_qty: Number(t.unissued_qty ?? 0),
    open_qty: Number(t.open_qty ?? 0),
    die_attach: Number(t.die_attach ?? 0),
    wire_bond: Number(t.wire_bond ?? 0),
    molding: Number(t.molding ?? 0),
    testing: Number(t.testing ?? 0),
    test_done: Number(t.test_done ?? 0),
    wip_qty: Number(t.wip_qty ?? 0),
  };
  // 兼容前端：同时提供 rows / data 字段
  return { rows, data: rows, total, totalRow };
}

async function queryFilter(client: ClickHouseClient, input: SummaryFilterInput): Promise<SummaryFilterOptions> {
  const safeDate = escStr(input.date);
  const [labelR, vendorR] = await Promise.all([
    client.query({
      query: `SELECT DISTINCT label_name FROM (${INNER_SQL}) WHERE date = '${safeDate}' ORDER BY label_name`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ label_name: string }>()),
    client.query({
      query: `SELECT DISTINCT vendor_name FROM (${INNER_SQL}) WHERE date = '${safeDate}' ORDER BY vendor_name`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ vendor_name: string }>()),
  ]);
  return {
    labelNames: labelR.map((r) => r.label_name),
    vendorNames: vendorR.map((r) => r.vendor_name),
  };
}

async function queryExport(client: ClickHouseClient, input: SummaryInput): Promise<SummaryExportReturn> {
  const r = await queryData(client, { ...input, page: 1, pageSize: 999_999 });
  return { data: r.rows, total: r.total, totalRow: r.totalRow };
}

// ─── 插件定义 ─────────────────────────────────────────────────────────────────
const plugin: ReportPlugin<
  WipRecord,
  SummaryInput,
  SummaryFilterInput,
  SummaryFilterOptions,
  SummaryQueryReturn,
  SummaryExportReturn
> = {
  meta: {
    code: "pkg_wip_summary",
    name: "封装厂WIP汇总表",
    category: "封装厂报表",
    description: "展示封装厂各工序在制品（WIP）汇总数据，支持按日期、标签品名、供应商查询",
    route: "/reports/pkg-wip-summary",
    icon: "BarChart2",
    sortOrder: 1,
  },

  inputSchema: z.object({
    date: z.string(),
    labelName: z.string().optional(),
    vendorName: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(20),
  }),
  exportInputSchema: z.object({
    date: z.string(),
    labelName: z.string().optional(),
    vendorName: z.string().optional(),
  }),
  filterOptionsInputSchema: z.object({ date: z.string() }),

  query: queryData,
  filterOptions: queryFilter,
  exportQuery: queryExport,

  emptyQueryResult: {
    rows: [], data: [], total: 0,
    totalRow: {
      label_name: "合计", vendor_part_no: "", vendor_name: "",
      unissued_qty: 0, open_qty: 0, die_attach: 0, wire_bond: 0,
      molding: 0, testing: 0, test_done: 0, wip_qty: 0,
    },
  },
  emptyFilterOptions: { labelNames: [], vendorNames: [] },

  mockQuery: (input) => {
    const m = generateMockWipData(input);
    return { rows: m.data, data: m.data, total: m.total, totalRow: m.totalRow };
  },
  mockFilterOptions: (input) => generateMockFilterOptions(input.date),
  mockExport: (input) => {
    const m = generateMockWipData({ ...input, page: 1, pageSize: 99999 });
    return { data: m.data, total: m.total, totalRow: m.totalRow };
  },

  rowsForExcel: (exported) => exported.data,

  excel: {
    sheetName: "封装厂WIP汇总表",
    title: (input) => `封装厂WIP汇总表  ${input.date}`,
    filenameParts: (input) => ["封装厂WIP汇总表", input.date],
    leftAlignCols: 3,
    columns: [
      { header: "标签品名",   width: 28, value: (r) => r.label_name },
      { header: "供应商料号", width: 18, value: (r) => r.vendor_part_no },
      { header: "供应商",     width: 18, value: (r) => r.vendor_name },
      { header: "未回货数量", width: 12, value: (r) => r.open_qty ?? "",
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
      { header: "测试后-入库", width: 14, value: (r) => r.test_done,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.test_done) || 0), 0) },
      { header: "合计WIP数量", width: 14, value: (r) => r.wip_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.wip_qty) || 0), 0) },
    ],
  },
};

export default plugin;
