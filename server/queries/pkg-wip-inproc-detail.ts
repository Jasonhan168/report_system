import type { ClickHouseClient } from "@clickhouse/client";

/**
 * 封装厂在制品明细表
 * 数据来源：v_dws_ab_wip（DWS 层汇总视图，无日期维度，每行带 update_time 进度更新时间）
 */
export interface WipInprocDetailRow {
  vendor_name: string;    // 委外厂商
  order_no: string;       // 委外订单号
  label_name: string;     // 标签品名
  vendor_part_no: string; // 供应商料号
  batch_no: string;       // 批号
  die_attach: number;     // 装片
  wire_bond: number;      // 焊线
  molding: number;        // 塑封
  testing: number;        // 测试
  test_done: number;      // 测试后
  total_wip: number;      // 合计WIP
  update_time: string;    // 进度更新
}

export interface WipInprocDetailFilters {
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

/** 合计WIP计算表达式（Null 安全） */
const TOTAL_WIP_EXPR = `(ifNull(die_attach, 0) + ifNull(wire_bond, 0) + ifNull(molding, 0) + ifNull(testing, 0) + ifNull(test_done, 0))`;

function buildWhere(filters: WipInprocDetailFilters): string {
  const parts: string[] = [`${TOTAL_WIP_EXPR} > 0`];
  if (filters.vendorName) {
    parts.push(`lower(ifNull(vendor_name, '')) LIKE lower('%${esc(filters.vendorName)}%')`);
  }
  if (filters.labelName) {
    parts.push(`lower(ifNull(label_name, '')) LIKE lower('%${esc(filters.labelName)}%')`);
  }
  if (filters.vendorPartNo) {
    parts.push(`lower(ifNull(vendor_part_no, '')) LIKE lower('%${esc(filters.vendorPartNo)}%')`);
  }
  return parts.join(" AND ");
}

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

/** 查询分页数据（后端过滤合计WIP=0的记录） */
export async function queryWipInprocDetail(
  client: ClickHouseClient,
  filters: WipInprocDetailFilters
): Promise<{ rows: WipInprocDetailRow[]; total: number }> {
  const where = buildWhere(filters);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const countSql = `
    SELECT count() AS cnt
    FROM v_dws_ab_wip
    WHERE ${where}
  `;
  const dataSql = `
    SELECT ${SELECT_COLS}
    FROM v_dws_ab_wip
    WHERE ${where}
    ORDER BY update_time DESC, vendor_name, order_no
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  type CountResult = { data: { cnt: string }[] };
  type DataResult = { data: WipInprocDetailRow[] };

  const [countResult, dataResult] = await Promise.all([
    client.query({ query: countSql }).then((r) => r.json() as Promise<CountResult>),
    client.query({ query: dataSql }).then((r) => r.json() as Promise<DataResult>),
  ]);

  const total = parseInt((countResult as CountResult).data[0]?.cnt ?? "0", 10);
  // 调试日志：跟踪查询结果（排查无数据问题）
  if (total === 0) {
    console.log("[pkg-wip-inproc-detail] 查询返回 0 条，当前 WHERE:", where);
  }
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
export async function queryWipInprocDetailFilterOptions(
  client: ClickHouseClient
): Promise<{ vendorNames: string[] }> {
  const sql = `
    SELECT groupUniqArray(ifNull(vendor_name, '')) AS vendor_names
    FROM v_dws_ab_wip
    WHERE ${TOTAL_WIP_EXPR} > 0
  `;
  type FilterResult = { data: { vendor_names: string[] }[] };
  const result = (await client.query({ query: sql }).then((r) => r.json())) as FilterResult;
  const row = result.data[0] ?? { vendor_names: [] };
  return {
    vendorNames: (row.vendor_names ?? []).filter(Boolean).sort(),
  };
}

/** 导出全量数据（不分页，后端过滤合计WIP=0） */
export async function exportWipInprocDetail(
  client: ClickHouseClient,
  filters: WipInprocDetailFilters
): Promise<WipInprocDetailRow[]> {
  const where = buildWhere(filters);
  const sql = `
    SELECT ${SELECT_COLS}
    FROM v_dws_ab_wip
    WHERE ${where}
    ORDER BY update_time DESC, vendor_name, order_no
    LIMIT 999999
  `;
  type ExportResult = { data: WipInprocDetailRow[] };
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
