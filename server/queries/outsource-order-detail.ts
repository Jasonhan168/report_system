import type { ClickHouseClient } from "@clickhouse/client";

export interface OutsourceOrderRow {
  order_no: string;
  order_date: string;
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

export interface OutsourceOrderFilters {
  date?: string;           // 日期，默认当天
  productionType?: string; // 工程量产
  vendorName?: string;     // 委外厂商（模糊）
  labelName?: string;      // 标签品名（模糊）
  vendorPartNo?: string;   // 供应商料号（模糊）
  plant?: string;          // 分公司（模糊）
  page?: number;
  pageSize?: number;
}

/** 转义单引号，防止 SQL 注入 */
function esc(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildWhere(filters: OutsourceOrderFilters): string {
  const date = filters.date || new Date().toISOString().slice(0, 10);
  const parts: string[] = [
    `date = '${esc(date)}'`,
    `received_rate < 98`,
  ];
  if (filters.productionType) {
    parts.push(`production_type = '${esc(filters.productionType)}'`);
  }
  if (filters.vendorName) {
    parts.push(`lower(vendor_name) LIKE lower('%${esc(filters.vendorName)}%')`);
  }
  if (filters.labelName) {
    parts.push(`lower(label) LIKE lower('%${esc(filters.labelName)}%')`);
  }
  if (filters.vendorPartNo) {
    parts.push(`lower(vendor_part_no) LIKE lower('%${esc(filters.vendorPartNo)}%')`);
  }
  if (filters.plant) {
    parts.push(`lower(plant) LIKE lower('%${esc(filters.plant)}%')`);
  }
  return parts.join(" AND ");
}

/** 查询分页数据 */
export async function queryOutsourceOrderDetail(
  client: ClickHouseClient,
  filters: OutsourceOrderFilters
): Promise<{ rows: OutsourceOrderRow[]; total: number }> {
  const where = buildWhere(filters);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const countSql = `SELECT count() AS cnt FROM wip_db.v_dwd_order WHERE ${where}`;
  const dataSql = `
    SELECT
      order_no,
      toString(order_date) AS order_date,
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
    FROM wip_db.v_dwd_order
    WHERE ${where}
    ORDER BY order_date DESC, order_no
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  type CountResult = { data: { cnt: string }[] };
  type DataResult = { data: OutsourceOrderRow[] };

  const [countResult, dataResult] = await Promise.all([
    client.query({ query: countSql }).then((r) => r.json() as Promise<CountResult>),
    client.query({ query: dataSql }).then((r) => r.json() as Promise<DataResult>),
  ]);

  const total = parseInt((countResult as CountResult).data[0]?.cnt ?? "0", 10);
  const rows = ((dataResult as DataResult).data ?? []).map((row) => ({
    ...row,
    qty: Number(row.qty),
    open_qty: Number(row.open_qty),
    received_rate: Number(row.received_rate),
  }));

  return { rows, total };
}

/** 获取筛选项（工程量产、委外厂商、分公司的枚举值） */
export async function queryOutsourceOrderFilterOptions(
  client: ClickHouseClient,
  date?: string
): Promise<{
  productionTypes: string[];
  vendorNames: string[];
  plants: string[];
}> {
  const d = date || new Date().toISOString().slice(0, 10);
  const sql = `
    SELECT
      groupUniqArray(production_type) AS production_types,
      groupUniqArray(vendor_name) AS vendor_names,
      groupUniqArray(plant) AS plants
    FROM wip_db.v_dwd_order
    WHERE date = '${esc(d)}' AND received_rate < 98
  `;
  type FilterResult = { data: { production_types: string[]; vendor_names: string[]; plants: string[] }[] };
  const result = (await client.query({ query: sql }).then((r) => r.json())) as FilterResult;
  const row = result.data[0] ?? { production_types: [], vendor_names: [], plants: [] };
  return {
    productionTypes: (row.production_types ?? []).filter(Boolean).sort(),
    vendorNames: (row.vendor_names ?? []).filter(Boolean).sort(),
    plants: (row.plants ?? []).filter(Boolean).sort(),
  };
}

/** 导出全量数据（不分页） */
export async function exportOutsourceOrderDetail(
  client: ClickHouseClient,
  filters: OutsourceOrderFilters
): Promise<OutsourceOrderRow[]> {
  const where = buildWhere(filters);
  const sql = `
    SELECT
      order_no,
      toString(order_date) AS order_date,
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
    FROM wip_db.v_dwd_order
    WHERE ${where}
    ORDER BY order_date DESC, order_no
    LIMIT 999999
  `;
  type ExportResult = { data: OutsourceOrderRow[] };
  const result = (await client.query({ query: sql }).then((r) => r.json())) as ExportResult;
  return (result.data ?? []).map((row) => ({
    ...row,
    qty: Number(row.qty),
    open_qty: Number(row.open_qty),
    received_rate: Number(row.received_rate),
  }));
}
