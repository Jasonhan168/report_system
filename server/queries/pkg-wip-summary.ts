/**
 * 封装厂 WIP 汇总表 —— ClickHouse 真实查询
 *
 * 兼容 ClickHouse 18.16.1（不支持 param_* 参数化、不支持 ILIKE）
 *
 * 数据来源：
 *   v_dwd_ab_wip_agg  (wip)
 *   v_dwd_order_agg   (ord)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { WipRecord } from "../mockData";

// ─── 参数类型 ─────────────────────────────────────────────────────────────────
export interface WipQueryParams {
  date: string;
  labelName?: string;
  vendorName?: string;
  page?: number;
  pageSize?: number;
}

// ─── SQL 转义（防注入）────────────────────────────────────────────────────────
// ClickHouse 18.x 字符串用单引号，转义单引号为 \'
function escStr(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ─── 内层子查询（固定逻辑，不含 WHERE / GROUP BY）────────────────────────────
// 注意：必须显式带出 date 字段，外层 WHERE 才能引用
const INNER_SQL = `
SELECT
    wip.date,
    wip.order_no,
    wip.label_name,
    wip.vendor_part_no,
    wip.vendor_name,
    ((((ord.open_qty - wip.die_attach) - wip.wire_bond) - wip.molding) - wip.testing) - wip.test_done AS unissued_qty,
    ord.open_qty,
    wip.die_attach,
    wip.wire_bond,
    wip.molding,
    wip.testing,
    wip.test_done,
    (((wip.die_attach + wip.wire_bond) + wip.molding) + wip.testing) + wip.test_done AS wip_qty
FROM v_dwd_ab_wip_agg AS wip
LEFT JOIN v_dwd_order_agg AS ord
    ON  wip.date           = ord.date
    AND wip.order_no       = ord.order_no
    AND wip.vendor_part_no = ord.vendor_part_no`;

// ─── 构建 WHERE 子句（直接拼接，已转义）──────────────────────────────────────
function buildWhere(params: WipQueryParams): string {
  const conditions: string[] = [`date = '${escStr(params.date)}'`];

  if (params.labelName) {
    // ILIKE 在 18.x 不支持，改用 lower() LIKE lower()
    conditions.push(`lower(label_name) LIKE lower('%${escStr(params.labelName)}%')`);
  }
  if (params.vendorName) {
    conditions.push(`lower(vendor_name) LIKE lower('%${escStr(params.vendorName)}%')`);
  }

  return conditions.join(" AND ");
}

// ─── 主查询（分页）────────────────────────────────────────────────────────────
export async function queryWipData(
  client: ClickHouseClient,
  params: WipQueryParams
): Promise<{ data: WipRecord[]; total: number; totalRow: WipRecord }> {
  const { page = 1, pageSize = 20 } = params;
  const where = buildWhere(params);
  const offset = (page - 1) * pageSize;

  // 1. 总行数（按 GROUP BY 后的行数）
  const countSql = `
SELECT count() AS cnt
FROM (
  SELECT label_name, vendor_part_no, vendor_name
  FROM (${INNER_SQL})
  WHERE ${where}
  GROUP BY label_name, vendor_part_no, vendor_name
)`;

  const countResult = await client.query({ query: countSql, format: "JSONEachRow" });
  const countRows = await countResult.json<{ cnt: string }>();
  const total = parseInt(countRows[0]?.cnt ?? "0", 10);

  // 2. 分页数据
  const dataSql = `
SELECT
    label_name,
    vendor_part_no,
    vendor_name,
    sum(unissued_qty)        AS unissued_qty,
    sum(open_qty)            AS open_qty,
    sum(die_attach)          AS die_attach,
    sum(wire_bond)           AS wire_bond,
    sum(molding)             AS molding,
    sum(testing)             AS testing,
    sum(test_done)           AS test_done,
    sum(wip_qty)             AS wip_qty,
    groupArray(order_no)     AS order_nos
FROM (${INNER_SQL})
WHERE ${where}
GROUP BY label_name, vendor_part_no, vendor_name
ORDER BY label_name, vendor_name
LIMIT ${pageSize} OFFSET ${offset}`;

  const dataResult = await client.query({ query: dataSql, format: "JSONEachRow" });
  const rawRows = await dataResult.json<Record<string, unknown>>();
  const data: WipRecord[] = rawRows.map(toWipRecord);

  // 3. 合计行（全量聚合，不受分页影响）
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

  const totalResult = await client.query({ query: totalSql, format: "JSONEachRow" });
  const totalRows = await totalResult.json<Record<string, string>>();
  const t = totalRows[0] ?? {};

  const totalRow: WipRecord = {
    label_name: "合计",
    vendor_part_no: "",
    vendor_name: "",
    unissued_qty: Number(t.unissued_qty ?? 0),
    open_qty: Number(t.open_qty ?? 0),
    die_attach: Number(t.die_attach ?? 0),
    wire_bond: Number(t.wire_bond ?? 0),
    molding: Number(t.molding ?? 0),
    testing: Number(t.testing ?? 0),
    test_done: Number(t.test_done ?? 0),
    wip_qty: Number(t.wip_qty ?? 0),
  };

  return { data, total, totalRow };
}

// ─── 筛选项查询（标签品名 / 供应商列表）────────────────────────────────────
export async function queryWipFilterOptions(
  client: ClickHouseClient,
  date: string
): Promise<{ labelNames: string[]; vendorNames: string[] }> {
  const safeDate = escStr(date);

  const labelSql = `
SELECT DISTINCT label_name
FROM (${INNER_SQL})
WHERE date = '${safeDate}'
ORDER BY label_name`;

  const vendorSql = `
SELECT DISTINCT vendor_name
FROM (${INNER_SQL})
WHERE date = '${safeDate}'
ORDER BY vendor_name`;

  const [labelResult, vendorResult] = await Promise.all([
    client.query({ query: labelSql, format: "JSONEachRow" }),
    client.query({ query: vendorSql, format: "JSONEachRow" }),
  ]);

  const labelRows = await labelResult.json<{ label_name: string }>();
  const vendorRows = await vendorResult.json<{ vendor_name: string }>();

  return {
    labelNames: labelRows.map((r) => r.label_name),
    vendorNames: vendorRows.map((r) => r.vendor_name),
  };
}

// ─── 全量导出（不分页）────────────────────────────────────────────────────────
export async function exportWipData(
  client: ClickHouseClient,
  params: Omit<WipQueryParams, "page" | "pageSize">
): Promise<{ data: WipRecord[]; total: number; totalRow: WipRecord }> {
  return queryWipData(client, { ...params, page: 1, pageSize: 999_999 });
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function toWipRecord(row: Record<string, unknown>): WipRecord {
  // order_nos 可能是数组或 JSON 字符串，统一解析为 string[]
  let order_nos: string[] = [];
  const raw = row.order_nos;
  if (Array.isArray(raw)) {
    order_nos = raw.map(String);
  } else if (typeof raw === "string" && raw.startsWith("[")) {
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
