import type { ClickHouseClient } from "@clickhouse/client";

export interface WipDetailRow {
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

export interface WipDetailFilters {
  date?: string;         // 日期，默认当天
  vendorName?: string;   // 委外厂商（模糊）
  labelName?: string;    // 标签品名（模糊）
  vendorPartNo?: string; // 供应商料号（模糊）
  page?: number;
  pageSize?: number;
}

/** 转义单引号，防止 SQL 注入 */
function esc(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildWhere(filters: WipDetailFilters): string {
  const date = filters.date || new Date().toISOString().slice(0, 10);
  const parts: string[] = [`date = '${esc(date)}'`];
  if (filters.vendorName) {
    parts.push(`lower(vendor_name) LIKE lower('%${esc(filters.vendorName)}%')`);
  }
  if (filters.labelName) {
    parts.push(`lower(label_name) LIKE lower('%${esc(filters.labelName)}%')`);
  }
  if (filters.vendorPartNo) {
    parts.push(`lower(vendor_part_no) LIKE lower('%${esc(filters.vendorPartNo)}%')`);
  }
  return parts.join(" AND ");
}

/** 合计WIP计算表达式 */
const TOTAL_WIP_EXPR = `(die_attach + wire_bond + molding + testing + test_done)`;

/** 查询分页数据（后端过滤合计WIP=0的记录） */
export async function queryWipDetail(
  client: ClickHouseClient,
  filters: WipDetailFilters
): Promise<{ rows: WipDetailRow[]; total: number }> {
  const where = buildWhere(filters);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  // 使用子查询在 WHERE 层过滤合计WIP>0，确保 count 与分页数据一致
  const countSql = `
    SELECT count() AS cnt
    FROM v_dwd_ab_wip
    WHERE ${where}
      AND ${TOTAL_WIP_EXPR} > 0
  `;
  const dataSql = `
    SELECT
      toString(date) AS date,
      vendor_name,
      order_no,
      label_name,
      vendor_part_no,
      batch_no,
      die_attach,
      wire_bond,
      molding,
      testing,
      test_done,
      ${TOTAL_WIP_EXPR} AS total_wip
    FROM v_dwd_ab_wip
    WHERE ${where}
      AND ${TOTAL_WIP_EXPR} > 0
    ORDER BY date DESC, vendor_name, order_no
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  type CountResult = { data: { cnt: string }[] };
  type DataResult = { data: WipDetailRow[] };

  const [countResult, dataResult] = await Promise.all([
    client.query({ query: countSql }).then((r) => r.json() as Promise<CountResult>),
    client.query({ query: dataSql }).then((r) => r.json() as Promise<DataResult>),
  ]);

  const total = parseInt((countResult as CountResult).data[0]?.cnt ?? "0", 10);
  const rows = ((dataResult as DataResult).data ?? []).map((row) => ({
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

/** 获取筛选项（委外厂商枚举值） */
export async function queryWipDetailFilterOptions(
  client: ClickHouseClient,
  date?: string
): Promise<{ vendorNames: string[] }> {
  const d = date || new Date().toISOString().slice(0, 10);
  const sql = `
    SELECT groupUniqArray(vendor_name) AS vendor_names
    FROM v_dwd_ab_wip
    WHERE date = '${esc(d)}'
      AND ${TOTAL_WIP_EXPR} > 0
  `;
  type FilterResult = { data: { vendor_names: string[] }[] };
  const result = (await client.query({ query: sql }).then((r) => r.json())) as FilterResult;
  const row = result.data[0] ?? { vendor_names: [] };
  return {
    vendorNames: (row.vendor_names ?? []).filter(Boolean).sort(),
  };
}

/** 导出全量数据（不分页，后端过滤合计WIP=0） */
export async function exportWipDetail(
  client: ClickHouseClient,
  filters: WipDetailFilters
): Promise<WipDetailRow[]> {
  const where = buildWhere(filters);
  const sql = `
    SELECT
      toString(date) AS date,
      vendor_name,
      order_no,
      label_name,
      vendor_part_no,
      batch_no,
      die_attach,
      wire_bond,
      molding,
      testing,
      test_done,
      ${TOTAL_WIP_EXPR} AS total_wip
    FROM v_dwd_ab_wip
    WHERE ${where}
      AND ${TOTAL_WIP_EXPR} > 0
    ORDER BY date DESC, vendor_name, order_no
    LIMIT 999999
  `;
  type ExportResult = { data: WipDetailRow[] };
  const result = (await client.query({ query: sql }).then((r) => r.json())) as ExportResult;
  return (result.data ?? []).map((row) => ({
    ...row,
    die_attach: Number(row.die_attach),
    wire_bond: Number(row.wire_bond),
    molding: Number(row.molding),
    testing: Number(row.testing),
    test_done: Number(row.test_done),
    total_wip: Number(row.total_wip),
  }));
}
