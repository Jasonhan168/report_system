/**
 * 封装在制品明细表 —— 报表插件
 *
 * 数据来源：v_dwd_order_wip
 * 特点：
 *   - 展示委外订单各工序在制品明细
 *   - 增加计算字段：wip_total、unissued_qty、overdue_days
 *   - 支持按委外厂商、封装形式、标签品名、供应商料号、工程/量产、分公司过滤
 */
import { z } from "zod";
import type { ReportPlugin } from "./_types";
import { type ReportDbClient, type EngineType, sqlCastStr, sqlCastInt64, sqlGroupUniqArrayIf, parseArrayResult } from "./_dbClient";

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
  order_no: string;        // 委外订单号
  order_date: string;      // 下单日期
  edd: string;             // 预计交期
  process_type: string;    // 加工类型
  production_type: string; // 工程/量产
  vendor_name: string;     // 委外厂商
  part_no: string;         // ERP料号
  lot_no: string;          // Lot No.
  label: string;           // 标签品名
  vendor_part_no: string;  // 供应商料号
  package_type: string;    // 封装形式
  order_qty: number;       // 下单数量
  open_qty: number;        // 未交数量（内部计算用，不展示）
  received_qty: number;    // 已回货数量（计算字段 = order_qty - open_qty）
  stock_qty: number;       // 库存数量
  in_transit_qty: number;  // 在途数量
  die_attach: number;      // 装片
  wire_bond: number;       // 焊线
  molding: number;         // 塑封
  testing: number;         // 测试
  test_done: number;       // 测试后
  plant: string;           // 分公司
  update_time: string;     // 更新时间
  wip_total: number;       // 在制品合计（计算字段）
  unissued_qty: number;    // 未投数量（计算字段 = open_qty - wip_total - stock_qty - in_transit_qty）
  overdue_days: number;    // 拖期天数（计算字段）
}

interface Input {
  vendorName?: string;
  packageType?: string;
  label?: string;
  vendorPartNo?: string;
  productionType?: string;
  plant?: string;
  page?: number;
  pageSize?: number;
}

interface FilterOptions {
  vendorNames: string[];
  packageTypes: string[];
  labels: string[];
  vendorPartNos: string[];
  productionTypes: string[];
  plants: string[];
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

/** 将 update_time 格式化为 yyyy-mm-dd HH:MM:SS；空值或无效时间返回空串 */
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v).slice(0, 19);
  if (!s || s.startsWith("0000-00-00") || s.startsWith("1970-01-01 00:00:00")) return "";
  return s;
}

/** 计算拖期天数：edd < 今日则返回正整数天数，否则返回 0 */
function computeOverdueDays(edd: string | null | undefined): number {
  if (!edd) return 0;
  const eddDate = new Date(edd);
  if (isNaN(eddDate.getTime())) return 0;
  const today = new Date(localToday());
  //return Math.max(0, Math.floor((today.getTime() - eddDate.getTime()) / 86400000));
  return Math.floor((today.getTime() - eddDate.getTime()) / 86400000);
}

// ─── 基础 SQL ────────────────────────────────────────────────────────────────
function getBaseSql(engine: EngineType): string {
  return `
SELECT
    ifNull(order_no, '')         AS order_no,
    ${sqlCastStr(engine, "ifNull(order_date, '')")} AS order_date,
    ${sqlCastStr(engine, "ifNull(edd, '')")}    AS edd,
    ifNull(process_type, '')     AS process_type,
    ifNull(production_type, '')  AS production_type,
    ifNull(vendor_name, '')      AS vendor_name,
    ifNull(part_no, '')          AS part_no,
    ifNull(lot_no, '')           AS lot_no,
    ifNull(label, '')            AS label,
    ifNull(vendor_part_no, '')   AS vendor_part_no,
    ifNull(package_type, '')     AS package_type,
    ifNull(order_qty, 0)         AS order_qty,
    ifNull(open_qty, 0)          AS open_qty,
    ifNull(stock_qty, 0)         AS stock_qty,
    ifNull(in_transit_qty, 0)    AS in_transit_qty,
    ifNull(die_attach, 0)        AS die_attach,
    ifNull(wire_bond, 0)         AS wire_bond,
    ifNull(molding, 0)           AS molding,
    ifNull(testing, 0)           AS testing,
    ifNull(test_done, 0)         AS test_done,
    ifNull(plant, '')            AS plant,
    ${sqlCastStr(engine, "ifNull(update_time, '')")} AS update_time
FROM v_dwd_order_wip
WHERE package_type != ''
  AND vendor_name IN (SELECT DISTINCT vendor_name FROM v_dws_ab_wip WHERE vendor_name != '')
`;
}

function buildWhere(p: Input): string {
  const conds: string[] = ["1 = 1"];
  if (p.vendorName)     conds.push(`vendor_name = '${esc(p.vendorName)}'`);
  if (p.packageType)    conds.push(`package_type = '${esc(p.packageType)}'`);
  if (p.label)          conds.push(`label = '${esc(p.label)}'`);
  if (p.vendorPartNo)   conds.push(`vendor_part_no = '${esc(p.vendorPartNo)}'`);
  if (p.productionType) conds.push(`production_type = '${esc(p.productionType)}'`);
  if (p.plant)          conds.push(`plant = '${esc(p.plant)}'`);
  return conds.join(" AND ");
}

function toRow(r: Record<string, unknown>): Row {
  const edd = String(r.edd ?? "").slice(0, 10);
  const eddStr = edd.startsWith("0000") ? "" : edd;
  const dieAttach = Number(r.die_attach ?? 0);
  const wireBond = Number(r.wire_bond ?? 0);
  const molding = Number(r.molding ?? 0);
  const testing = Number(r.testing ?? 0);
  const testDone = Number(r.test_done ?? 0);
  const wipTotal = dieAttach + wireBond + molding + testing + testDone;
  const orderQty = Number(r.order_qty ?? 0);
  const openQty = Number(r.open_qty ?? 0);
  const stockQty = Number(r.stock_qty ?? 0);
  const inTransitQty = Number(r.in_transit_qty ?? 0);

  return {
    order_no:      String(r.order_no      ?? ""),
    order_date:    String(r.order_date    ?? ""),
    edd:           eddStr,
    process_type:  String(r.process_type  ?? ""),
    production_type: String(r.production_type ?? ""),
    vendor_name:   String(r.vendor_name   ?? ""),
    part_no:       String(r.part_no       ?? ""),
    lot_no:        String(r.lot_no        ?? ""),
    label:         String(r.label         ?? ""),
    vendor_part_no: String(r.vendor_part_no ?? ""),
    package_type:  String(r.package_type  ?? ""),
    order_qty:     orderQty,
    open_qty:      openQty,
    received_qty:  orderQty - openQty,
    stock_qty:     stockQty,
    in_transit_qty: inTransitQty,
    die_attach:    dieAttach,
    wire_bond:     wireBond,
    molding:       molding,
    testing:       testing,
    test_done:     testDone,
    plant:         String(r.plant          ?? ""),
    update_time:   String(r.update_time   ?? ""),
    wip_total:     wipTotal,
    unissued_qty:  openQty - wipTotal - stockQty - inTransitQty,
    overdue_days:  computeOverdueDays(eddStr),
  };
}

// ─── 数据库查询 ─────────────────────────────────────────────────────────────
// 策略说明：
//   1) query：数据分页 + 统计(count/sum)拆分为两条独立 SQL 并行执行，
//      规避 ClickHouse 18.16.1 UNION ALL 中 count() 在 WHERE 生效时返回 0 的兼容问题。
//   2) filterOptions：用 groupUniqArrayIf 单次扫描即可一次性聚合 6 个字段的去重列表。
async function queryData(client: ReportDbClient, input: Input): Promise<QueryReturn> {
  const { page = 1, pageSize = 20 } = input;
  const engine = client.engineType;
  const BASE_SQL = getBaseSql(engine);
  const where = buildWhere(input);
  const offset = (page - 1) * pageSize;

  const dataSql = `
SELECT
  order_no, order_date, edd, process_type, production_type,
  vendor_name, part_no, lot_no, label, vendor_part_no, package_type,
  order_qty, open_qty, stock_qty, in_transit_qty, die_attach, wire_bond, molding, testing, test_done,
  plant, update_time
FROM (${BASE_SQL}) AS t
WHERE ${where}
ORDER BY order_date DESC, order_no, lot_no
LIMIT ${pageSize} OFFSET ${offset}`;

  const metaSql = `
SELECT
  count(*)                     AS _cnt,
  ${sqlCastInt64(engine, "sum(order_qty)")}     AS order_qty,
  ${sqlCastInt64(engine, "sum(open_qty)")}      AS open_qty,
  ${sqlCastInt64(engine, "sum(stock_qty)")}     AS stock_qty,
  ${sqlCastInt64(engine, "sum(in_transit_qty)")} AS in_transit_qty,
  ${sqlCastInt64(engine, "sum(die_attach)")}    AS die_attach,
  ${sqlCastInt64(engine, "sum(wire_bond)")}     AS wire_bond,
  ${sqlCastInt64(engine, "sum(molding)")}       AS molding,
  ${sqlCastInt64(engine, "sum(testing)")}       AS testing,
  ${sqlCastInt64(engine, "sum(test_done)")}     AS test_done,
  ${sqlCastStr(engine, "max(update_time)")}  AS update_time
FROM (${BASE_SQL}) AS t
WHERE ${where}`;

  const [dataR, metaR] = await Promise.all([
    client.query<Record<string, unknown>>(dataSql),
    client.query<Record<string, unknown>>(metaSql),
  ]);

  const rows = dataR.map(toRow);
  const metaRow = metaR[0] ?? {};

  const total = parseInt(String(metaRow._cnt ?? "0"), 10);

  const orderQty  = Number(metaRow.order_qty  ?? 0);
  const openQty   = Number(metaRow.open_qty   ?? 0);
  const stockQty  = Number(metaRow.stock_qty  ?? 0);
  const inTransitQty = Number(metaRow.in_transit_qty ?? 0);
  const dieAttach = Number(metaRow.die_attach ?? 0);
  const wireBond  = Number(metaRow.wire_bond  ?? 0);
  const molding   = Number(metaRow.molding    ?? 0);
  const testing   = Number(metaRow.testing    ?? 0);
  const testDone  = Number(metaRow.test_done  ?? 0);
  const wipTotal  = dieAttach + wireBond + molding + testing + testDone;

  const totalRow: Row = {
    order_no: "", order_date: "", edd: "", process_type: "", production_type: "",
    vendor_name: "", part_no: "", lot_no: "合计", label: "", vendor_part_no: "",
    package_type: "", plant: "",
    order_qty:    orderQty,
    open_qty:     openQty,
    received_qty: orderQty - openQty,
    stock_qty:    stockQty,
    in_transit_qty: inTransitQty,
    die_attach:   dieAttach,
    wire_bond:    wireBond,
    molding:      molding,
    testing:      testing,
    test_done:    testDone,
    update_time:  String(metaRow.update_time ?? ""),
    wip_total:    wipTotal,
    unissued_qty: openQty - wipTotal - stockQty - inTransitQty,
    overdue_days: 0,
  };

  return { rows, data: rows, total, totalRow };
}

async function queryFilter(client: ReportDbClient): Promise<FilterOptions> {
  const engine = client.engineType;
  const BASE_SQL = getBaseSql(engine);

  const sql = `
SELECT
  ${sqlGroupUniqArrayIf(engine, "vendor_name", "vendor_name != ''")} AS vendor_names,
  ${sqlGroupUniqArrayIf(engine, "package_type", "package_type != ''")} AS package_types,
  ${sqlGroupUniqArrayIf(engine, "label", "label != ''")} AS labels,
  ${sqlGroupUniqArrayIf(engine, "vendor_part_no", "vendor_part_no != ''")} AS vendor_part_nos,
  ${sqlGroupUniqArrayIf(engine, "production_type", "production_type != ''")} AS production_types,
  ${sqlGroupUniqArrayIf(engine, "plant", "plant != ''")} AS plants
FROM (${BASE_SQL}) AS t`;

  const r = await client.query<Record<string, unknown>>(sql);

  const row = r[0] ?? {};

  return {
    vendorNames:     parseArrayResult(row.vendor_names).sort(),
    packageTypes:    parseArrayResult(row.package_types).sort(),
    labels:          parseArrayResult(row.labels).sort(),
    vendorPartNos:   parseArrayResult(row.vendor_part_nos).sort(),
    productionTypes: parseArrayResult(row.production_types).sort(),
    plants:          parseArrayResult(row.plants).sort(),
  };
}

async function queryExport(client: ReportDbClient, input: Input): Promise<ExportReturn> {
  const r = await queryData(client, { ...input, page: 1, pageSize: 999_999 });
  return { data: r.rows, total: r.total, totalRow: r.totalRow };
}

// ─── 空合计行 ────────────────────────────────────────────────────────────────
const EMPTY_TOTAL_ROW: Row = {
  order_no: "", order_date: "", edd: "", process_type: "", production_type: "",
  vendor_name: "", part_no: "", lot_no: "合计", label: "", vendor_part_no: "",
  package_type: "", plant: "",
  order_qty: 0, open_qty: 0, received_qty: 0, stock_qty: 0, in_transit_qty: 0,
  die_attach: 0, wire_bond: 0, molding: 0, testing: 0, test_done: 0,
  update_time: "", wip_total: 0, unissued_qty: 0, overdue_days: 0,
};

// ─── 插件定义 ────────────────────────────────────────────────────────────────
const plugin: ReportPlugin<Row, Input, void, FilterOptions, QueryReturn, ExportReturn> = {
  meta: {
    code: "order_wip_detail",
    name: "封装在制品明细表",
    category: "封装厂报表",
    description: "展示委外订单各工序在制品明细（来源：v_dwd_order_wip，含在制品合计、未投数量、拖期天数计算）",
    route: "/reports/order-wip-detail",
    icon: "PackageSearch",
    sortOrder: 4,
  },

  inputSchema: z.object({
    vendorName:     z.string().optional(),
    packageType:    z.string().optional(),
    label:          z.string().optional(),
    vendorPartNo:   z.string().optional(),
    productionType: z.string().optional(),
    plant:          z.string().optional(),
    page:           z.number().min(1).default(1),
    pageSize:       z.number().min(1).max(200).default(20),
  }),
  exportInputSchema: z.object({
    vendorName:     z.string().optional(),
    packageType:    z.string().optional(),
    label:          z.string().optional(),
    vendorPartNo:   z.string().optional(),
    productionType: z.string().optional(),
    plant:          z.string().optional(),
  }),
  filterOptionsInputSchema: undefined,

  query:         queryData,
  filterOptions: (client) => queryFilter(client),
  exportQuery:   queryExport,

  emptyQueryResult: {
    rows: [], data: [], total: 0,
    totalRow: EMPTY_TOTAL_ROW,
  },
  emptyFilterOptions: { vendorNames: [], packageTypes: [], labels: [], vendorPartNos: [], productionTypes: [], plants: [] },

  rowsForExcel: (exported) => exported.data,

  excel: {
    sheetName: "封装在制品明细表",
    title: () => `封装在制品明细表  ${localToday()}`,
    filenameParts: (input) => {
      const today = localToday();
      const parts = ["封装在制品明细表", today];
      if (input.vendorName)     parts.push(input.vendorName);
      else if (input.packageType)    parts.push(input.packageType);
      else if (input.label)          parts.push(input.label);
      else if (input.vendorPartNo)   parts.push(input.vendorPartNo);
      else if (input.productionType) parts.push(input.productionType);
      else if (input.plant)          parts.push(input.plant);
      return parts;
    },
    leftAlignCols: 6,
    columns: [
      // 前 6 列：文本左对齐
      { header: "下单日期",     width: 12, value: (r) => String(r.order_date ?? "").slice(0, 10) },
      { header: "委外订单号",   width: 18, value: (r) => r.order_no },
      { header: "Lot No.",      width: 16, value: (r) => r.lot_no },
      { header: "标签品名",     width: 24, value: (r) => r.label },
      { header: "供应商料号",   width: 18, value: (r) => r.vendor_part_no },
      { header: "封装形式",     width: 14, value: (r) => r.package_type },
      // 数值列：右对齐
      { header: "下单数量",     width: 12, value: (r) => r.order_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.order_qty) || 0), 0) },
      { header: "已回货数量",   width: 12, value: (r) => r.received_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.received_qty) || 0), 0) },
      { header: "未投数量",     width: 12, value: (r) => r.unissued_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.unissued_qty) || 0), 0) },
      { header: "装片",         width: 10, value: (r) => r.die_attach,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.die_attach) || 0), 0) },
      { header: "焊线",         width: 10, value: (r) => r.wire_bond,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.wire_bond) || 0), 0) },
      { header: "塑封",         width: 10, value: (r) => r.molding,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.molding) || 0), 0) },
      { header: "测试",         width: 10, value: (r) => r.testing,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.testing) || 0), 0) },
      { header: "测试后",       width: 10, value: (r) => r.test_done,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.test_done) || 0), 0) },
      { header: "在制品合计",   width: 12, value: (r) => r.wip_total,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.wip_total) || 0), 0) },
      { header: "完工未回",     width: 12, value: (r) => r.stock_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.stock_qty) || 0), 0) },
      { header: "在途数量",     width: 12, value: (r) => r.in_transit_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.in_transit_qty) || 0), 0) },
      { header: "拖期天数",     width: 10, value: (r) => r.overdue_days > 0 ? r.overdue_days : "" },
      // 后 7 列：文本左对齐
      { header: "预计交期",     width: 12, value: (r) => r.edd || "" },
      { header: "加工类型",     width: 12, value: (r) => r.process_type },
      { header: "工程/量产",    width: 12, value: (r) => r.production_type },
      { header: "委外厂商",     width: 18, value: (r) => r.vendor_name },
      { header: "ERP料号",      width: 16, value: (r) => r.part_no },
      { header: "分公司",       width: 12, value: (r) => r.plant },
      { header: "更新时间",     width: 20, value: (r) => fmtDateTime(r.update_time) },
    ],
  },
};

export default plugin;
