/**
 * 封装厂WIP明细表 —— 报表插件
 *
 * 数据来源：v_dwd_ab_wip（DWD 明细，按日期筛选）
 */
import { z } from "zod";
import type { ReportPlugin } from "./_types";
import { type ReportDbClient, sqlCastStr, sqlGroupUniqArray, parseArrayResult } from "./_dbClient";

/** 获取服务器本地时区的当前日期字符串（yyyy-mm-dd），避免 UTC 偏移导致凌晨显示前一天 */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Row {
  date: string;
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
}

interface Input {
  date?: string;
  vendorName?: string;
  labelName?: string;
  vendorPartNo?: string;
  page?: number;
  pageSize?: number;
}

interface FilterInput { date?: string }
interface FilterOptions { vendorNames: string[] }

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const TOTAL_WIP_EXPR = `(die_attach + wire_bond + molding + testing + test_done)`;

function buildWhere(f: Input): string {
  const date = f.date || localToday();
  const parts: string[] = [`date = '${esc(date)}'`];
  if (f.vendorName) parts.push(`lower(vendor_name) LIKE lower('%${esc(f.vendorName)}%')`);
  if (f.labelName) parts.push(`lower(label_name) LIKE lower('%${esc(f.labelName)}%')`);
  if (f.vendorPartNo) parts.push(`lower(vendor_part_no) LIKE lower('%${esc(f.vendorPartNo)}%')`);
  return parts.join(" AND ");
}

const SELECT_COLS = (engine: ReportDbClient["engineType"]) => `
  ${sqlCastStr(engine, "date")} AS date,
  vendor_name, order_no, label_name, vendor_part_no, batch_no,
  die_attach, wire_bond, molding, testing, test_done,
  ${TOTAL_WIP_EXPR} AS total_wip
`;

async function queryData(client: ReportDbClient, input: Input): Promise<{ rows: Row[]; total: number }> {
  const where = buildWhere(input);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const cols = SELECT_COLS(client.engineType);

  const countSql = `SELECT count(*) AS cnt FROM v_dwd_ab_wip WHERE ${where} AND ${TOTAL_WIP_EXPR} > 0`;
  const dataSql = `
    SELECT ${cols}
    FROM v_dwd_ab_wip
    WHERE ${where} AND ${TOTAL_WIP_EXPR} > 0
    ORDER BY date DESC, vendor_name, order_no
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const [countR, dataR] = await Promise.all([
    client.query<{ cnt: string }>(countSql),
    client.query<Row>(dataSql),
  ]);

  const total = parseInt(countR[0]?.cnt ?? "0", 10);
  const rows = (dataR ?? []).map((row) => ({
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

async function queryFilter(client: ReportDbClient, input: FilterInput): Promise<FilterOptions> {
  const d = input.date || localToday();
  const engine = client.engineType;
  const sql = `
    SELECT ${sqlGroupUniqArray(engine, "vendor_name")} AS vendor_names
    FROM v_dwd_ab_wip
    WHERE date = '${esc(d)}' AND ${TOTAL_WIP_EXPR} > 0
  `;
  const r = await client.query<{ vendor_names: unknown }>(sql);
  const row = r[0] ?? { vendor_names: [] };
  return { vendorNames: parseArrayResult(row.vendor_names).filter(Boolean).sort() };
}

async function queryExport(client: ReportDbClient, input: Input): Promise<Row[]> {
  const where = buildWhere(input);
  const cols = SELECT_COLS(client.engineType);
  const sql = `
    SELECT ${cols}
    FROM v_dwd_ab_wip
    WHERE ${where} AND ${TOTAL_WIP_EXPR} > 0
    ORDER BY date DESC, vendor_name, order_no
    LIMIT 999999
  `;
  const r = await client.query<Row>(sql);
  return (r ?? []).map((row) => ({
    ...row,
    die_attach: Number(row.die_attach),
    wire_bond: Number(row.wire_bond),
    molding: Number(row.molding),
    testing: Number(row.testing),
    test_done: Number(row.test_done),
    total_wip: Number(row.total_wip),
  }));
}

const plugin: ReportPlugin<Row, Input, FilterInput, FilterOptions> = {
  meta: {
    code: "pkg_wip_detail",
    name: "封装厂WIP明细表",
    category: "封装厂报表",
    description: "按日期查询封装厂WIP明细数据（来源：v_dwd_ab_wip）",
    route: "/reports/pkg-wip-detail",
    icon: "List",
    sortOrder: 30,
  },

  inputSchema: z.object({
    date: z.string().optional(),
    vendorName: z.string().optional(),
    labelName: z.string().optional(),
    vendorPartNo: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(50),
  }),
  exportInputSchema: z.object({
    date: z.string().optional(),
    vendorName: z.string().optional(),
    labelName: z.string().optional(),
    vendorPartNo: z.string().optional(),
  }),
  filterOptionsInputSchema: z.object({ date: z.string().optional() }),

  query: queryData,
  filterOptions: queryFilter,
  exportQuery: queryExport,

  emptyQueryResult: { rows: [], total: 0 },
  emptyFilterOptions: { vendorNames: [] },
  emptyExportRows: [],

  excel: {
    sheetName: "封装厂WIP明细表",
    title: (input) => `封装厂WIP明细表  ${input.date || localToday()}`,
    filenameParts: (input) => {
      const d = input.date || localToday();
      const parts = ["封装厂WIP明细表", d];
      if (input.vendorName) parts.push(input.vendorName);
      else if (input.labelName) parts.push(input.labelName);
      return parts;
    },
    leftAlignCols: 6,
    columns: [
      { header: "日期",       width: 12, value: (r) => r.date },
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
    ],
  },
};

export default plugin;
