/**
 * 委外订单明细表 —— 报表插件
 *
 * 数据来源：v_dwd_order
 * WHERE 固定：date = 指定日期（默认当天） AND received_rate < 98
 * 支持从汇总表下钻时传入 orderNos 精确过滤
 */
import { z } from "zod";
import type { ClickHouseClient } from "@clickhouse/client";
import type { ReportPlugin } from "./_types";

interface Row {
  order_no: string;
  order_date: string;
  edd: string;
  process_type: string;
  production_type: string;
  vendor_name: string;
  part_no: string;
  lot_no: string;
  label: string;
  vendor_part_no: string;
  qty: number;
  open_qty: number;
  received_rate: number;
  plant: string;
}

interface Input {
  date?: string;
  productionType?: string;
  vendorName?: string;
  labelName?: string;
  vendorPartNo?: string;
  plant?: string;
  orderNos?: string[];
  page?: number;
  pageSize?: number;
}

interface FilterInput { date?: string }
interface FilterOptions {
  productionTypes: string[];
  vendorNames: string[];
  plants: string[];
}

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildWhere(f: Input): string {
  const date = f.date || new Date().toISOString().slice(0, 10);
  const parts: string[] = [
    `date = '${esc(date)}'`,
    `received_rate < 98`,
  ];
  if (f.productionType) parts.push(`production_type = '${esc(f.productionType)}'`);
  if (f.vendorName) parts.push(`lower(vendor_name) LIKE lower('%${esc(f.vendorName)}%')`);
  if (f.labelName) parts.push(`lower(label) LIKE lower('%${esc(f.labelName)}%')`);
  if (f.vendorPartNo) parts.push(`lower(vendor_part_no) LIKE lower('%${esc(f.vendorPartNo)}%')`);
  if (f.plant) parts.push(`lower(plant) LIKE lower('%${esc(f.plant)}%')`);
  if (f.orderNos && f.orderNos.length > 0) {
    const inList = f.orderNos.map((n) => `'${esc(n)}'`).join(",");
    parts.push(`order_no IN (${inList})`);
  }
  return parts.join(" AND ");
}

const SELECT_COLS = `
  order_no,
  toString(order_date) AS order_date,
  toString(edd) AS edd,
  process_type,
  production_type,
  vendor_name,
  part_no,
  lot_no,
  label,
  vendor_part_no,
  qty,
  open_qty,
  received_rate,
  plant
`;

function normalizeRow(row: Row): Row {
  return {
    ...row,
    qty: Number(row.qty),
    open_qty: Number(row.open_qty),
    received_rate: Number(row.received_rate),
  };
}

/** 计算拖期天数（edd < 今日则返回整数天数，否则 0） */
function computeOverdueDays(edd: string): number {
  if (!edd) return 0;
  const eddDate = new Date(edd);
  if (isNaN(eddDate.getTime())) return 0;
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.max(0, Math.floor((today.getTime() - eddDate.getTime()) / 86400000));
}

async function queryData(client: ClickHouseClient, input: Input): Promise<{ rows: Row[]; total: number }> {
  const where = buildWhere(input);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const countSql = `SELECT count() AS cnt FROM v_dwd_order WHERE ${where}`;
  const dataSql = `
    SELECT ${SELECT_COLS}
    FROM v_dwd_order
    WHERE ${where}
    ORDER BY order_date DESC, order_no
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  type CountResult = { data: { cnt: string }[] };
  type DataResult = { data: Row[] };

  const [countR, dataR] = await Promise.all([
    client.query({ query: countSql }).then((r) => r.json() as Promise<CountResult>),
    client.query({ query: dataSql }).then((r) => r.json() as Promise<DataResult>),
  ]);

  const total = parseInt(countR.data[0]?.cnt ?? "0", 10);
  const rows = (dataR.data ?? []).map(normalizeRow);
  return { rows, total };
}

async function queryFilter(client: ClickHouseClient, input: FilterInput): Promise<FilterOptions> {
  const d = input.date || new Date().toISOString().slice(0, 10);
  const sql = `
    SELECT
      groupUniqArray(production_type) AS production_types,
      groupUniqArray(vendor_name) AS vendor_names,
      groupUniqArray(plant) AS plants
    FROM v_dwd_order
    WHERE date = '${esc(d)}' AND received_rate < 98
  `;
  type R = { data: { production_types: string[]; vendor_names: string[]; plants: string[] }[] };
  const r = (await client.query({ query: sql }).then((x) => x.json())) as R;
  const row = r.data[0] ?? { production_types: [], vendor_names: [], plants: [] };
  return {
    productionTypes: (row.production_types ?? []).filter(Boolean).sort(),
    vendorNames: (row.vendor_names ?? []).filter(Boolean).sort(),
    plants: (row.plants ?? []).filter(Boolean).sort(),
  };
}

async function queryExport(client: ClickHouseClient, input: Input): Promise<Row[]> {
  const where = buildWhere(input);
  const sql = `
    SELECT ${SELECT_COLS}
    FROM v_dwd_order
    WHERE ${where}
    ORDER BY order_date DESC, order_no
    LIMIT 999999
  `;
  type R = { data: Row[] };
  const r = (await client.query({ query: sql }).then((x) => x.json())) as R;
  return (r.data ?? []).map(normalizeRow);
}

const plugin: ReportPlugin<Row, Input, FilterInput, FilterOptions> = {
  meta: {
    code: "outsource_order_detail",
    name: "委外订单明细表",
    category: "生产报表",
    description: "按日期查询委外订单明细，received_rate<98为固定条件",
    route: "/reports/outsource-order-detail",
    icon: "ClipboardList",
    sortOrder: 20,
  },

  inputSchema: z.object({
    date: z.string().optional(),
    productionType: z.string().optional(),
    vendorName: z.string().optional(),
    labelName: z.string().optional(),
    vendorPartNo: z.string().optional(),
    plant: z.string().optional(),
    orderNos: z.array(z.string()).optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(50),
  }),
  exportInputSchema: z.object({
    date: z.string().optional(),
    productionType: z.string().optional(),
    vendorName: z.string().optional(),
    labelName: z.string().optional(),
    vendorPartNo: z.string().optional(),
    plant: z.string().optional(),
    orderNos: z.array(z.string()).optional(),
  }),
  filterOptionsInputSchema: z.object({ date: z.string().optional() }),

  query: queryData,
  filterOptions: queryFilter,
  exportQuery: queryExport,

  emptyQueryResult: { rows: [], total: 0 },
  emptyFilterOptions: { productionTypes: [], vendorNames: [], plants: [] },
  emptyExportRows: [],

  excel: {
    sheetName: "委外订单明细表",
    title: (input) => `委外订单明细表  ${input.date || new Date().toISOString().slice(0, 10)}`,
    filenameParts: (input) => {
      const d = input.date || new Date().toISOString().slice(0, 10);
      const parts = ["委外订单明细表", d];
      if (input.vendorName) parts.push(input.vendorName);
      else if (input.labelName) parts.push(input.labelName);
      return parts;
    },
    leftAlignCols: 9,
    columns: [
      { header: "订单号",       width: 16, value: (r) => r.order_no },
      { header: "订单日期",     width: 12, value: (r) => r.order_date },
      { header: "预计交期",     width: 12, value: (r) => r.edd || "" },
      { header: "工序类型",     width: 12, value: (r) => r.process_type },
      { header: "工程量产",     width: 12, value: (r) => r.production_type },
      { header: "委外厂商",     width: 18, value: (r) => r.vendor_name },
      { header: "料号",         width: 14, value: (r) => r.part_no },
      { header: "批号",         width: 12, value: (r) => r.lot_no },
      { header: "标签品名",     width: 20, value: (r) => r.label },
      { header: "供应商料号",   width: 18, value: (r) => r.vendor_part_no },
      { header: "订单数量",     width: 12, value: (r) => r.qty,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.qty) || 0), 0) },
      { header: "未回货数量",   width: 12, value: (r) => r.open_qty,
        totalValue: (rs) => rs.reduce((s, x) => s + (Number(x.open_qty) || 0), 0) },
      { header: "回货率(%)",    width: 12, value: (r) => r.received_rate },
      { header: "分公司",       width: 12, value: (r) => r.plant },
      { header: "拖期天数",     width: 10, value: (r) => {
          const d = computeOverdueDays(r.edd);
          return d > 0 ? d : "";
        } },
    ],
  },
};

export default plugin;
