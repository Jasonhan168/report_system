/**
 * 封装在制品汇总表 —— 报表插件
 *
 * 与《封装厂在制品汇总表》(pkg_wip_inproc_summary) 的差异：
 *   - 数据源改为单一视图 v_dwd_order_wip，不再由报表侧 JOIN v_dwd_order_agg × v_dws_ab_wip_agg
 *   - 未投数量 unissued_qty 直接取视图字段（ifNull 兜底 0），不再由后端反算
 *   - 封装形式 package_type 由视图直接提供，无需再额外关联 v_dwd_order 补字段
 *   - 原表保持不变，两张表并行提供，便于口径对比
 *
 * ── 关于 v_dwd_order_wip 对「江苏长电」的处理 ────────────────────────────────
 * 该视图并未排除江苏长电，而是用 UNION ALL 分成两段，对江苏长电的取数逻辑做了微调：
 *
 *   第一段（vendor_name != '江苏长电'）：
 *     - dwd_order 逐行（不预聚合）LEFT JOIN WIP，关联键 = (order_no, vendor_part_no, lot_no)
 *     - 额外要求 vendor_name IN (SELECT DISTINCT vendor_name FROM dws_ab_wip)
 *     - 未投数量基数取订单原始 qty
 *
 *   第二段（vendor_name = '江苏长电'）：
 *     - dwd_order 先按 (date, order_no, vendor_part_no, vendor_name) 预聚合，
 *       SUM(qty) → order_qty、SUM(open_qty) → open_qty，其余字段取 ANY_VALUE
 *     - lot_no 取 SPLIT_PART(lot_no, '_', 1)，即剥掉下划线后缀
 *     - LEFT JOIN WIP 的关联键只用 (order_no, vendor_part_no)，不含 lot_no
 *     - 不要求 vendor_name 出现在 dws_ab_wip 中
 *     - 未投数量基数取预聚合后的 order_qty
 *
 *   两段共同的订单过滤条件：date = CURDATE()、order_status != '已结案'、received_rate < 98。
 *
 * 因此本报表的行集与原《封装厂在制品汇总表》不完全一致：
 * 非江苏长电部分要求供应商在 dws_ab_wip 中出现过，而江苏长电部分因关联键不含 lot_no，
 * 同一 (order_no, vendor_part_no) 存在多批次时订单侧数量会按批次重复参与聚合。
 */
import { z } from "zod";
import type { ReportPlugin } from "./_types";
import { type ReportDbClient, sqlCastStr, sqlGroupUniqArray, sqlArrayStringConcat, parseArrayResult } from "./_dbClient";

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
  /** 封装形式（v_dwd_order_wip 直接提供） */
  package_type: string;
  vendor_name: string;
  open_qty: number;
  /** 未投数量（直接取视图字段） */
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

/** 内层查询：订单 × 批次单行粒度，直接取自 v_dwd_order_wip 并做 NULL 安全化 */
const INNER_SQL = `
SELECT
    ifNull(order_no, '')       AS order_no,
    ifNull(label, '')          AS label_name,
    ifNull(vendor_part_no, '') AS vendor_part_no,
    ifNull(package_type, '')   AS package_type,
    ifNull(vendor_name, '')    AS vendor_name,
    ifNull(open_qty, 0)        AS open_qty,
    ifNull(unissued_qty, 0)    AS unissued_qty,
    ifNull(die_attach, 0)      AS die_attach,
    ifNull(wire_bond, 0)       AS wire_bond,
    ifNull(molding, 0)         AS molding,
    ifNull(testing, 0)         AS testing,
    ifNull(test_done, 0)       AS test_done,
    (ifNull(die_attach, 0)
     + ifNull(wire_bond, 0)
     + ifNull(molding, 0)
     + ifNull(testing, 0)
     + ifNull(test_done, 0))   AS wip_qty,
    update_time                AS update_time
FROM v_dwd_order_wip`;

function buildWhere(p: Input): string {
  const conds: string[] = [];
  if (p.labelName) conds.push(`lower(label_name) LIKE lower('%${esc(p.labelName)}%')`);
  if (p.vendorName) conds.push(`lower(vendor_name) LIKE lower('%${esc(p.vendorName)}%')`);
  if (p.packageType) conds.push(`lower(package_type) LIKE lower('%${esc(p.packageType)}%')`);
  return conds.length ? "WHERE " + conds.join(" AND ") : "";
}

function toRow(r: Record<string, unknown>): Row {
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
    order_nos: parseArrayResult(r.order_nos),
  };
}

// ─── 数据查询 ────────────────────────────────────────────────────────────────
async function queryData(client: ReportDbClient, input: Input): Promise<QueryReturn> {
  const { page = 1, pageSize = 20 } = input;
  const where = buildWhere(input);
  const offset = (page - 1) * pageSize;
  const engine = client.engineType;

  const countSql = `
SELECT count(*) AS cnt
FROM (
  SELECT vendor_part_no, vendor_name
  FROM (${INNER_SQL}) AS t
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
  SELECT * FROM (${INNER_SQL}) AS t
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
  SELECT * FROM (${INNER_SQL}) AS t
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
  const [labelR, vendorR, pkgR] = await Promise.all([
    client.query<{ label_name: string }>(
      `SELECT DISTINCT label_name FROM (${INNER_SQL}) AS t WHERE label_name != '' ORDER BY label_name`,
    ),
    client.query<{ vendor_name: string }>(
      `SELECT DISTINCT vendor_name FROM (${INNER_SQL}) AS t WHERE vendor_name != '' ORDER BY vendor_name`,
    ),
    client.query<{ package_type: string }>(
      `SELECT DISTINCT package_type FROM (${INNER_SQL}) AS t WHERE package_type != '' ORDER BY package_type`,
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
    code: "pkg_inproc_summary",
    name: "封装在制品汇总表",
    category: "封装厂报表",
    description: "按当天订单聚合展示封装各工序在制品汇总（来源：v_dwd_order_wip，未投数量直取视图字段）",
    route: "/reports/pkg-inproc-summary",
    icon: "BarChart3",
    sortOrder: 4,
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
    sheetName: "封装在制品汇总表",
    title: () => `封装在制品汇总表  ${localToday()}`,
    filenameParts: (input) => {
      const today = localToday();
      const parts = ["封装在制品汇总表", today];
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
