/**
 * 封装厂在制品明细表 —— 报表插件
 *
 * 数据来源：v_dws_ab_wip（DWS 层 argMax 聚合，无日期维度，带 update_time）
 * 所有字段 ifNull 包裹以应对 Nullable(...) 类型的 NULL 传播问题
 */
import { z } from "zod";
import type { ClickHouseClient } from "@clickhouse/client";
import type { ReportPlugin } from "./_types";

/** 获取服务器本地时区的当前日期字符串（yyyy-mm-dd），避免 UTC 偏移导致凌晨显示前一天 */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Row {
  vendor_name: string;
  order_no: string;
  label_name: string;
  vendor_part_no: string;
  batch_no: string;
  die_attach: number;
  wire_bond: number;
  molding: number;
  testing: number;
  test_done: number;
  total_wip: number;
  update_time: string;
}

interface Input {
  vendorName?: string;
  labelName?: string;
  vendorPartNo?: string;
  page?: number;
  pageSize?: number;
}

interface FilterOptions { vendorNames: string[] }

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const TOTAL_WIP_EXPR = `(ifNull(die_attach, 0) + ifNull(wire_bond, 0) + ifNull(molding, 0) + ifNull(testing, 0) + ifNull(test_done, 0))`;

const SELECT_COLS = `
  ifNull(vendor_name, '') AS vendor_name,
  ifNull(order_no, '') AS order_no,
  ifNull(label_name, '') AS label_name,
  ifNull(vendor_part_no, '') AS vendor_part_no,
  ifNull(batch_no, '') AS batch_no,
  ifNull(die_attach, 0) AS die_attach,
  ifNull(wire_bond, 0) AS wire_bond,
  ifNull(molding, 0) AS molding,
  ifNull(testing, 0) AS testing,
  ifNull(test_done, 0) AS test_done,
  ${TOTAL_WIP_EXPR} AS total_wip,
  toString(update_time) AS update_time
`;

function buildWhere(f: Input): string {
  const parts: string[] = [`${TOTAL_WIP_EXPR} > 0`];
  if (f.vendorName) parts.push(`lower(ifNull(vendor_name, '')) LIKE lower('%${esc(f.vendorName)}%')`);
  if (f.labelName) parts.push(`lower(ifNull(label_name, '')) LIKE lower('%${esc(f.labelName)}%')`);
  if (f.vendorPartNo) parts.push(`lower(ifNull(vendor_part_no, '')) LIKE lower('%${esc(f.vendorPartNo)}%')`);
  return parts.join(" AND ");
}

async function queryData(client: ClickHouseClient, input: Input): Promise<{ rows: Row[]; total: number }> {
  const where = buildWhere(input);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const countSql = `SELECT count() AS cnt FROM v_dws_ab_wip WHERE ${where}`;
  const dataSql = `
    SELECT ${SELECT_COLS}
    FROM v_dws_ab_wip
    WHERE ${where}
    ORDER BY update_time DESC, vendor_name, order_no
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  type CountResult = { data: { cnt: string }[] };
  type DataResult = { data: Row[] };
  const [countR, dataR] = await Promise.all([
    client.query({ query: countSql }).then((r) => r.json() as Promise<CountResult>),
    client.query({ query: dataSql }).then((r) => r.json() as Promise<DataResult>),
  ]);

  const total = parseInt(countR.data[0]?.cnt ?? "0", 10);
  const rows = (dataR.data ?? []).map((row) => ({
    ...row,
    die_attach: Number(row.die_attach),
    wire_bond: Number(row.wire_bond),
    molding: Number(row.molding),
    testing: Number(row.testing),
    test_done: Number(row.test_done),
    total_wip: Number(row.total_wip),
  }));
  return { rows, total };
}

async function queryFilter(client: ClickHouseClient): Promise<FilterOptions> {
  const sql = `
    SELECT groupUniqArray(ifNull(vendor_name, '')) AS vendor_names
    FROM v_dws_ab_wip
    WHERE ${TOTAL_WIP_EXPR} > 0
  `;
  type R = { data: { vendor_names: string[] }[] };
  const r = (await client.query({ query: sql }).then((x) => x.json())) as R;
  const row = r.data[0] ?? { vendor_names: [] };
  return { vendorNames: (row.vendor_names ?? []).filter(Boolean).sort() };
}

async function queryExport(client: ClickHouseClient, input: Input): Promise<Row[]> {
  const where = buildWhere(input);
  const sql = `
    SELECT ${SELECT_COLS}
    FROM v_dws_ab_wip
    WHERE ${where}
    ORDER BY update_time DESC, vendor_name, order_no
    LIMIT 999999
  `;
  type R = { data: Row[] };
  const r = (await client.query({ query: sql }).then((x) => x.json())) as R;
  return (r.data ?? []).map((row) => ({
    ...row,
    die_attach: Number(row.die_attach),
    wire_bond: Number(row.wire_bond),
    molding: Number(row.molding),
    testing: Number(row.testing),
    test_done: Number(row.test_done),
    total_wip: Number(row.total_wip),
  }));
}

const plugin: ReportPlugin<Row, Input, void, FilterOptions> = {
  meta: {
    code: "pkg_wip_inproc_detail",
    name: "封装厂在制品明细表",
    category: "生产报表",
    description: "封装厂在制品当前快照明细（来源：v_dws_ab_wip，带进度更新时间）",
    route: "/reports/pkg-wip-inproc-detail",
    icon: "List",
    sortOrder: 40,
  },

  inputSchema: z.object({
    vendorName: z.string().optional(),
    labelName: z.string().optional(),
    vendorPartNo: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(50),
  }),
  exportInputSchema: z.object({
    vendorName: z.string().optional(),
    labelName: z.string().optional(),
    vendorPartNo: z.string().optional(),
  }),
  // 无参数
  filterOptionsInputSchema: undefined,

  query: queryData,
  filterOptions: (client) => queryFilter(client),
  exportQuery: queryExport,

  emptyQueryResult: { rows: [], total: 0 },
  emptyFilterOptions: { vendorNames: [] },
  emptyExportRows: [],

  excel: {
    sheetName: "封装厂在制品明细表",
    title: () => `封装厂在制品明细表  ${localToday()}`,
    filenameParts: (input) => {
      const today = localToday();
      const parts = ["封装厂在制品明细表", today];
      if (input.vendorName) parts.push(input.vendorName);
      else if (input.labelName) parts.push(input.labelName);
      return parts;
    },
    leftAlignCols: 5,
    columns: [
      { header: "委外厂商",   width: 18, value: (r) => r.vendor_name },
      { header: "委外订单号", width: 16, value: (r) => r.order_no },
      { header: "标签品名",   width: 20, value: (r) => r.label_name },
      { header: "供应商料号", width: 18, value: (r) => r.vendor_part_no },
      { header: "批号",       width: 14, value: (r) => r.batch_no },
      { header: "装片",       width: 10, value: (r) => r.die_attach,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.die_attach) || 0), 0) },
      { header: "焊线",       width: 10, value: (r) => r.wire_bond,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.wire_bond) || 0), 0) },
      { header: "塑封",       width: 10, value: (r) => r.molding,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.molding) || 0), 0) },
      { header: "测试",       width: 10, value: (r) => r.testing,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.testing) || 0), 0) },
      { header: "测试后",     width: 10, value: (r) => r.test_done,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.test_done) || 0), 0) },
      { header: "合计WIP数量", width: 14, value: (r) => r.total_wip,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.total_wip) || 0), 0) },
      { header: "进度更新",   width: 18, value: (r) => r.update_time },
    ],
  },
};

export default plugin;
