/**
 * 封装订单未投数量统计表 —— 交叉表（数据透视）报表插件
 *
 * 数据来源：v_dwd_order_wip
 * 展示形式：行=封装形式，列=供应商，值=未投数量
 * 行列均带合计
 */
import { z } from "zod";
import type { ReportPlugin, ExcelConfig } from "./_types";
import { type ReportDbClient } from "./_dbClient";

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 交叉表单行 */
export interface PivotRow {
  packageType: string;
  /** 供应商 -> 未投数量 */
  values: Record<string, number>;
  /** 行合计 */
  rowTotal: number;
}

/** 查询输入 */
interface Input {
  packageType?: string;
  productionType?: string;
  page?: number;
  pageSize?: number;
}

/** 筛选项 */
interface FilterOptions {
  packageTypes: string[];
  productionTypes: string[];
}

/** query 返回 */
export interface QueryReturn {
  vendors: string[];
  rows: PivotRow[];
  totalRow: PivotRow;
  colTotals: Record<string, number>;
  grandTotal: number;
  total: number;
}

/** export 返回 */
export interface ExportReturn {
  vendors: string[];
  rows: PivotRow[];
  totalRow: PivotRow;
  colTotals: Record<string, number>;
  grandTotal: number;
}

// ─── 核心 SQL ────────────────────────────────────────────────────────────────

const UNISSUED_EXPR = `
  (ifNull(open_qty, 0)
   - ifNull(die_attach, 0)
   - ifNull(wire_bond, 0)
   - ifNull(molding, 0)
   - ifNull(testing, 0)
   - ifNull(test_done, 0)
   - ifNull(stock_qty, 0)
   - ifNull(in_transit_qty, 0))
`;

const BASE_SQL = `
SELECT
  ifNull(package_type, '') AS package_type,
  ifNull(vendor_name, '')  AS vendor_name,
  sum(${UNISSUED_EXPR}) AS unissued_qty
FROM v_dwd_order_wip
WHERE package_type != '' and vendor_name in (select distinct vendor_name from v_dws_ab_wip where vendor_name != '')
`;

function buildWhere(input: Input): string {
  const conds: string[] = [];
  if (input.packageType) {
    conds.push(`lower(package_type) LIKE lower('%${esc(input.packageType)}%')`);
  }
  if (input.productionType) {
    conds.push(`production_type = '${esc(input.productionType)}'`);
  }
  return conds.length ? `AND ${conds.join(" AND ")}` : "";
}

// ─── 数据组装 ────────────────────────────────────────────────────────────────

interface FlatRow {
  package_type: string;
  vendor_name: string;
  unissued_qty: number;
}

function buildPivot(flatRows: FlatRow[]): {
  vendors: string[];
  matrix: Record<string, PivotRow>;
  colTotals: Record<string, number>;
  grandTotal: number;
} {
  const vendorSet = new Set<string>();
  for (const r of flatRows) {
    if (r.vendor_name) vendorSet.add(r.vendor_name);
  }
  const vendors = Array.from(vendorSet).sort();

  const matrix: Record<string, PivotRow> = {};
  const colTotals: Record<string, number> = {};
  for (const v of vendors) colTotals[v] = 0;
  let grandTotal = 0;

  for (const r of flatRows) {
    const pt = r.package_type;
    if (!matrix[pt]) {
      matrix[pt] = { packageType: pt, values: {}, rowTotal: 0 };
    }
    const qty = Number(r.unissued_qty) || 0;
    const vn = r.vendor_name || "（未知）";
    matrix[pt].values[vn] = (matrix[pt].values[vn] || 0) + qty;
    matrix[pt].rowTotal += qty;
    if (vendors.includes(vn)) {
      colTotals[vn] = (colTotals[vn] || 0) + qty;
    }
    grandTotal += qty;
  }

  return { vendors, matrix, colTotals, grandTotal };
}

// ─── ClickHouse 查询 ─────────────────────────────────────────────────────────

async function queryData(client: ReportDbClient, input: Input): Promise<QueryReturn> {
  const { page = 1, pageSize = 50 } = input;
  const where = buildWhere(input);

  const sql = `${BASE_SQL} ${where} GROUP BY package_type, vendor_name ORDER BY package_type, vendor_name`;

  const raw = await client.query<Record<string, unknown>>(sql);

  const flatRows: FlatRow[] = raw.map((r) => ({
    package_type: String(r.package_type ?? ""),
    vendor_name: String(r.vendor_name ?? ""),
    unissued_qty: Number(r.unissued_qty ?? 0),
  }));

  const { vendors, matrix, colTotals, grandTotal } = buildPivot(flatRows);

  // 按封装形式分页
  const allTypes = Object.keys(matrix).sort();
  const total = allTypes.length;
  const offset = (page - 1) * pageSize;
  const pagedTypes = allTypes.slice(offset, offset + pageSize);

  const rows = pagedTypes.map((pt) => matrix[pt]);

  const totalRow: PivotRow = {
    packageType: "合计",
    values: { ...colTotals },
    rowTotal: grandTotal,
  };

  return { vendors, rows, totalRow, colTotals, grandTotal, total };
}

async function queryFilter(client: ReportDbClient): Promise<FilterOptions> {
  const ptSql = `
    SELECT DISTINCT package_type
    FROM v_dwd_order_wip
    WHERE package_type != ''
    ORDER BY package_type
  `;
  const prodSql = `
    SELECT DISTINCT production_type
    FROM v_dwd_order_wip
    WHERE production_type != ''
    ORDER BY production_type
  `;
  const [ptR, prodR] = await Promise.all([
    client.query<{ package_type: string }>(ptSql),
    client.query<{ production_type: string }>(prodSql),
  ]);
  return {
    packageTypes: ptR.map((r) => r.package_type).filter(Boolean),
    productionTypes: prodR.map((r) => r.production_type).filter(Boolean),
  };
}

async function queryExport(client: ReportDbClient, input: Input): Promise<ExportReturn> {
  const r = await queryData(client, { ...input, page: 1, pageSize: 999_999 });
  return {
    vendors: r.vendors,
    rows: r.rows,
    totalRow: r.totalRow,
    colTotals: r.colTotals,
    grandTotal: r.grandTotal,
  };
}

// ─── Excel 配置生成器 ────────────────────────────────────────────────────────

function makeExcelConfig(vendors: string[]): ExcelConfig<PivotRow, Input> {
  const columns: ExcelConfig<PivotRow, Input>["columns"] = [
    {
      header: "封装形式",
      width: 18,
      value: (r) => r.packageType,
      totalValue: () => "合计",
    },
  ];

  for (const v of vendors) {
    columns.push({
      header: v,
      width: 14,
      value: (r) => r.values[v] ?? "",
      totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.values[v]) || 0), 0),
    });
  }

  columns.push({
    header: "合计",
    width: 14,
    value: (r) => r.rowTotal,
    totalValue: (rs) => rs.reduce((s, r) => s + (Number(r.rowTotal) || 0), 0),
  });

  return {
    sheetName: "封装订单未投数量统计表",
    title: () => `封装订单未投数量统计表  ${localToday()}`,
    filenameParts: (input) => {
      const parts = ["封装订单未投数量统计表", localToday()];
      if (input.packageType) parts.push(input.packageType);
      if (input.productionType) parts.push(input.productionType);
      return parts;
    },
    leftAlignCols: 1,
    columns,
  };
}

// ─── 插件定义 ────────────────────────────────────────────────────────────────

const plugin: ReportPlugin<
  PivotRow,
  Input,
  void,
  FilterOptions,
  QueryReturn,
  ExportReturn
> = {
  meta: {
    code: "pkg_unissued_pivot",
    name: "封装订单未投数量统计表",
    category: "封装厂报表",
    description: "按封装形式 × 供应商交叉统计未投数量（来源：v_dwd_order_wip）",
    route: "/reports/pkg-unissued-pivot",
    icon: "BarChart3",
    sortOrder: 3,
  },

  inputSchema: z.object({
    packageType: z.string().optional(),
    productionType: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(200).default(50),
  }),
  exportInputSchema: z.object({
    packageType: z.string().optional(),
    productionType: z.string().optional(),
  }),
  filterOptionsInputSchema: undefined,

  query: queryData,
  filterOptions: (_client) => queryFilter(_client),
  exportQuery: queryExport,

  emptyQueryResult: {
    vendors: [],
    rows: [],
    totalRow: { packageType: "合计", values: {}, rowTotal: 0 },
    colTotals: {},
    grandTotal: 0,
    total: 0,
  },
  emptyFilterOptions: { packageTypes: [], productionTypes: [] },

  rowsForExcel: (exported) => exported.rows,

  excel: (input: Input, exported: ExportReturn): ExcelConfig<PivotRow, Input> => {
    return makeExcelConfig(exported.vendors);
  },
};

export default plugin;
