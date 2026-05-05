/**
 * 工程批封装在制品报表 —— 报表插件
 *
 * 数据来源：v_dwd_order（工程批当天订单）LEFT JOIN v_dws_ab_wip（在制品快照）
 * 特点：
 *   - 仅取当天 (today()) 数据，不需要用户选择日期
 *   - 仅查询 production_type='2:工程' 的工程批订单
 *   - 过滤已结案订单和回货率 >= 98% 的订单
 *   - 江苏长电厂商因订单拆分方式不同，使用集合 B（按 order_no + vendor_part_no 聚合）
 *   - 其余厂商使用集合 A（按 order_no + vendor_part_no + lot_no 三键关联）
 *   - 支持按委外厂商、标签品名、封装形式过滤
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

// ─── 类型定义 ────────────────────────────────────────────────────────────────
interface Row {
  order_no: string;
  order_date: string;
  edd: string;           // 预计交期
  process_type: string;
  vendor_name: string;
  part_no: string;
  lot_no: string;
  label: string;
  vendor_part_no: string;
  package_type: string;
  order_qty: number;
  open_qty: number;
  before_attach: number;
  die_attach: number;
  wire_bond: number;
  molding: number;
  testing: number;
  test_done: number;
  update_time: string;
  overdue_days: number;  // 拖期天数（后端计算）
}

interface Input {
  vendorName?: string;
  label?: string;
  packageType?: string;
  page?: number;
  pageSize?: number;
}

interface FilterOptions {
  vendorNames: string[];
  labels: string[];
  packageTypes: string[];
}

interface QueryReturn {
  rows: Row[];
  data: Row[];
  total: number;
  totalRow: Omit<Row, "order_no" | "order_date" | "edd" | "process_type" | "vendor_name" | "part_no" | "lot_no" | "label" | "vendor_part_no" | "package_type" | "update_time" | "overdue_days"> & {
    label: string;
    vendor_name: string;
    order_no: string;
    order_date: string;
    edd: string;
    process_type: string;
    part_no: string;
    lot_no: string;
    vendor_part_no: string;
    package_type: string;
    update_time: string;
    overdue_days: number;
  };
}

interface ExportReturn {
  data: Row[];
  total: number;
  totalRow: QueryReturn["totalRow"];
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
  return Math.max(0, Math.floor((today.getTime() - eddDate.getTime()) / 86400000));
}

// ─── 联合查询 SQL（集合 A UNION ALL 集合 B）────────────────────────────────────
const UNION_SQL = `
/* ========== 集合 A：非江苏长电厂商 ========== */
SELECT
    ifNull(o.order_no, '')         AS order_no,
    toString(ifNull(o.order_date, '')) AS order_date,
    toString(ifNull(o.edd, ''))    AS edd,
    ifNull(o.process_type, '')     AS process_type,
    ifNull(o.vendor_name, '')      AS vendor_name,
    ifNull(o.part_no, '')          AS part_no,
    ifNull(o.lot_no, '')           AS lot_no,
    ifNull(o.label, '')            AS label,
    ifNull(o.vendor_part_no, '')   AS vendor_part_no,
    ifNull(o.package_type, '')     AS package_type,
    ifNull(o.order_qty, 0)         AS order_qty,
    ifNull(o.open_qty, 0)          AS open_qty,
    ifNull(w.before_attach, 0)     AS before_attach,
    ifNull(w.die_attach, 0)        AS die_attach,
    ifNull(w.wire_bond, 0)         AS wire_bond,
    ifNull(w.molding, 0)           AS molding,
    ifNull(w.testing, 0)           AS testing,
    ifNull(w.test_done, 0)         AS test_done,
    toString(ifNull(w.update_time, '')) AS update_time
FROM
(
    SELECT process_type, order_no, order_date, edd, vendor_name, label, part_no,
           vendor_part_no, package_type, lot_no, qty AS order_qty, open_qty
    FROM v_dwd_order
    WHERE date = today()
      AND production_type = '2:工程'
      AND order_status <> '已结案'
      AND vendor_name <> '江苏长电'
      AND received_rate < 98
) AS o
LEFT JOIN
(
    SELECT order_no, vendor_part_no, batch_no AS lot_no,
           before_attach, die_attach, wire_bond, molding, testing, test_done,
           update_time
    FROM v_dws_ab_wip
) AS w
ON o.order_no = w.order_no AND o.vendor_part_no = w.vendor_part_no AND o.lot_no = w.lot_no

UNION ALL

/* ========== 集合 B：江苏长电（按 order_no + vendor_part_no 聚合）========== */
SELECT
    ifNull(o.order_no, '')         AS order_no,
    toString(ifNull(o.order_date, '')) AS order_date,
    toString(ifNull(o.edd, ''))    AS edd,
    ifNull(o.process_type, '')     AS process_type,
    ifNull(o.vendor_name, '')      AS vendor_name,
    ifNull(o.part_no, '')          AS part_no,
    ifNull(o.lot_no, '')           AS lot_no,
    ifNull(o.label, '')            AS label,
    ifNull(o.vendor_part_no, '')   AS vendor_part_no,
    ifNull(o.package_type, '')     AS package_type,
    ifNull(o.order_qty, 0)         AS order_qty,
    ifNull(o.open_qty, 0)          AS open_qty,
    ifNull(w.before_attach, 0)     AS before_attach,
    ifNull(w.die_attach, 0)        AS die_attach,
    ifNull(w.wire_bond, 0)         AS wire_bond,
    ifNull(w.molding, 0)           AS molding,
    ifNull(w.testing, 0)           AS testing,
    ifNull(w.test_done, 0)         AS test_done,
    toString(ifNull(w.update_time, '')) AS update_time
FROM
(
    SELECT order_no, vendor_part_no,
           any(process_type)   AS process_type,
           any(order_date)     AS order_date,
           any(edd)            AS edd,
           vendor_name,
           any(label)          AS label,
           any(part_no)        AS part_no,
           any(package_type)   AS package_type,
           any(lot_no)         AS lot_no,
           sum(qty)            AS order_qty,
           sum(open_qty)       AS open_qty
    FROM v_dwd_order
    WHERE date = today()
      AND production_type = '2:工程'
      AND order_status <> '已结案'
      AND vendor_name = '江苏长电'
      AND received_rate < 98
    GROUP BY date, order_no, vendor_part_no, vendor_name
) AS o
LEFT JOIN
(
    SELECT order_no, vendor_part_no,
           before_attach, die_attach, wire_bond, molding, testing, test_done,
           update_time
    FROM v_dws_ab_wip
) AS w
ON o.order_no = w.order_no AND o.vendor_part_no = w.vendor_part_no
`;

function buildWhere(p: Input): string {
  const conds: string[] = ["1 = 1"];
  if (p.vendorName) conds.push(`lower(vendor_name) LIKE lower('%${esc(p.vendorName)}%')`);
  if (p.label)      conds.push(`lower(label) LIKE lower('%${esc(p.label)}%')`);
  if (p.packageType) conds.push(`lower(package_type) LIKE lower('%${esc(p.packageType)}%')`);
  return conds.join(" AND ");
}

function toRow(r: Record<string, unknown>): Row {
  const edd = String(r.edd ?? "").slice(0, 10);
  // 截取 yyyy-mm-dd 部分；ClickHouse 可能返回 Date 对象或带时间的字符串
  const eddStr = edd.startsWith("0000") ? "" : edd;
  return {
    order_no:      String(r.order_no      ?? ""),
    order_date:    String(r.order_date    ?? ""),
    edd:           eddStr,
    process_type:  String(r.process_type  ?? ""),
    vendor_name:   String(r.vendor_name   ?? ""),
    part_no:       String(r.part_no       ?? ""),
    lot_no:        String(r.lot_no        ?? ""),
    label:         String(r.label         ?? ""),
    vendor_part_no: String(r.vendor_part_no ?? ""),
    package_type:  String(r.package_type  ?? ""),
    order_qty:     Number(r.order_qty     ?? 0),
    open_qty:      Number(r.open_qty      ?? 0),
    before_attach: Number(r.before_attach ?? 0),
    die_attach:    Number(r.die_attach    ?? 0),
    wire_bond:     Number(r.wire_bond     ?? 0),
    molding:       Number(r.molding       ?? 0),
    testing:       Number(r.testing       ?? 0),
    test_done:     Number(r.test_done     ?? 0),
    update_time:   String(r.update_time   ?? ""),
    overdue_days:  computeOverdueDays(eddStr),
  };
}

// ─── ClickHouse 查询 ─────────────────────────────────────────────────────────
async function queryData(client: ClickHouseClient, input: Input): Promise<QueryReturn> {
  const { page = 1, pageSize = 20 } = input;
  const where = buildWhere(input);
  const offset = (page - 1) * pageSize;

  const countSql = `
SELECT count() AS cnt
FROM (${UNION_SQL})
WHERE ${where}`;

  const dataSql = `
SELECT *
FROM (${UNION_SQL})
WHERE ${where}
ORDER BY vendor_name, order_no, lot_no
LIMIT ${pageSize} OFFSET ${offset}`;

  const totalSql = `
SELECT
    sum(order_qty)     AS order_qty,
    sum(open_qty)      AS open_qty,
    sum(before_attach) AS before_attach,
    sum(die_attach)    AS die_attach,
    sum(wire_bond)     AS wire_bond,
    sum(molding)       AS molding,
    sum(testing)       AS testing,
    sum(test_done)     AS test_done,
    toString(max(update_time)) AS update_time
FROM (${UNION_SQL})
WHERE ${where}`;

  const [countR, dataR, totalR] = await Promise.all([
    client.query({ query: countSql, format: "JSONEachRow" }).then((r) => r.json<{ cnt: string }>()),
    client.query({ query: dataSql,  format: "JSONEachRow" }).then((r) => r.json<Record<string, unknown>>()),
    client.query({ query: totalSql, format: "JSONEachRow" }).then((r) => r.json<Record<string, string>>()),
  ]);

  const total = parseInt(countR[0]?.cnt ?? "0", 10);
  const rows = dataR.map(toRow);
  const t = totalR[0] ?? {};
  const totalRow: QueryReturn["totalRow"] = {
    order_no: "",
    order_date: "",
    edd: "",
    process_type: "",
    vendor_name: "",
    part_no: "",
    lot_no: "合计",
    label: "",
    vendor_part_no: "",
    package_type: "",
    order_qty:     Number(t.order_qty     ?? 0),
    open_qty:      Number(t.open_qty      ?? 0),
    before_attach: Number(t.before_attach ?? 0),
    die_attach:    Number(t.die_attach    ?? 0),
    wire_bond:     Number(t.wire_bond     ?? 0),
    molding:       Number(t.molding       ?? 0),
    testing:       Number(t.testing       ?? 0),
    test_done:     Number(t.test_done     ?? 0),
    update_time:   String(t.update_time   ?? ""),
    overdue_days:  0,
  };
  return { rows, data: rows, total, totalRow };
}

async function queryFilter(client: ClickHouseClient): Promise<FilterOptions> {
  const BASE = `FROM (${UNION_SQL})`;

  const [vendorR, labelR, pkgR] = await Promise.all([
    client.query({
      query: `SELECT DISTINCT vendor_name FROM (${UNION_SQL}) WHERE vendor_name != '' ORDER BY vendor_name`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ vendor_name: string }>()),
    client.query({
      query: `SELECT DISTINCT label FROM (${UNION_SQL}) WHERE label != '' ORDER BY label`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ label: string }>()),
    client.query({
      query: `SELECT DISTINCT package_type FROM (${UNION_SQL}) WHERE package_type != '' ORDER BY package_type`,
      format: "JSONEachRow",
    }).then((r) => r.json<{ package_type: string }>()),
  ]);

  // 避免 TypeScript 报 BASE 未使用
  void BASE;

  return {
    vendorNames:  vendorR.map((r) => r.vendor_name),
    labels:       labelR.map((r) => r.label),
    packageTypes: pkgR.map((r) => r.package_type),
  };
}

async function queryExport(client: ClickHouseClient, input: Input): Promise<ExportReturn> {
  const r = await queryData(client, { ...input, page: 1, pageSize: 999_999 });
  return { data: r.rows, total: r.total, totalRow: r.totalRow };
}

// ─── 空合计行 ────────────────────────────────────────────────────────────────
const EMPTY_TOTAL_ROW: QueryReturn["totalRow"] = {
  order_no: "", order_date: "", edd: "", process_type: "", vendor_name: "",
  part_no: "", lot_no: "合计", label: "", vendor_part_no: "",
  package_type: "", order_qty: 0, open_qty: 0, before_attach: 0,
  die_attach: 0, wire_bond: 0, molding: 0, testing: 0, test_done: 0,
  update_time: "", overdue_days: 0,
};

// ─── 插件定义 ────────────────────────────────────────────────────────────────
const plugin: ReportPlugin<Row, Input, void, FilterOptions, QueryReturn, ExportReturn> = {
  meta: {
    code: "eng_pkg_wip",
    name: "工程批封装在制品报表",
    category: "封装厂报表",
    description: "按当天订单展示工程批（production_type=2:工程）各工序在制品明细（来源：v_dwd_order × v_dws_ab_wip，含更新时间）",
    route: "/reports/eng-pkg-wip",
    icon: "FlaskConical",
    sortOrder: 3,
  },

  inputSchema: z.object({
    vendorName:  z.string().optional(),
    label:       z.string().optional(),
    packageType: z.string().optional(),
    page:        z.number().min(1).default(1),
    pageSize:    z.number().min(1).max(200).default(20),
  }),
  exportInputSchema: z.object({
    vendorName:  z.string().optional(),
    label:       z.string().optional(),
    packageType: z.string().optional(),
  }),
  filterOptionsInputSchema: undefined,

  query:         queryData,
  filterOptions: (client) => queryFilter(client),
  exportQuery:   queryExport,

  emptyQueryResult: {
    rows: [], data: [], total: 0,
    totalRow: EMPTY_TOTAL_ROW,
  },
  emptyFilterOptions: { vendorNames: [], labels: [], packageTypes: [] },

  rowsForExcel: (exported) => exported.data,

  excel: {
    sheetName: "工程批封装在制品报表",
    title: () => `工程批封装在制品报表  ${localToday()}`,
    filenameParts: (input) => {
      const today = localToday();
      const parts = ["工程批封装在制品报表", today];
      if (input.vendorName)  parts.push(input.vendorName);
      else if (input.label)  parts.push(input.label);
      else if (input.packageType) parts.push(input.packageType);
      return parts;
    },
    leftAlignCols: 10,
    columns: [
      { header: "委外订单号",   width: 18, value: (r) => r.order_no },
      { header: "下单日期",     width: 12, value: (r) => String(r.order_date ?? "").slice(0, 10) },
      { header: "预计交期",     width: 12, value: (r) => r.edd || "" },
      { header: "加工类型",     width: 12, value: (r) => r.process_type },
      { header: "委外厂商",     width: 18, value: (r) => r.vendor_name },
      { header: "ERP料号",      width: 16, value: (r) => r.part_no },
      { header: "Lot No.",      width: 16, value: (r) => r.lot_no },
      { header: "标签品名",     width: 24, value: (r) => r.label },
      { header: "供应商料号",   width: 18, value: (r) => r.vendor_part_no },
      { header: "封装形式",     width: 14, value: (r) => r.package_type },
      { header: "下单数量",     width: 12, value: (r) => r.order_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.order_qty) || 0), 0) },
      { header: "未回货数量",   width: 12, value: (r) => r.open_qty,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.open_qty) || 0), 0) },
      { header: "装片前",       width: 10, value: (r) => r.before_attach,
        totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.before_attach) || 0), 0) },
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
      { header: "更新时间",     width: 20, value: (r) => fmtDateTime(r.update_time) },
      { header: "拖期天数",     width: 10, value: (r) => r.overdue_days > 0 ? r.overdue_days : "" },
    ],
  },
};

export default plugin;
