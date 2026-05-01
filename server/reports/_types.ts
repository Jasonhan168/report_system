/**
 * 报表插件接口定义
 *
 * 每个报表只需要实现一个 ReportPlugin，即可被自动注册为：
 *   - tRPC 子路由（checkPermission / filterOptions / query / exportData）
 *   - Express 导出接口（/api/export/<code>）
 *   - report_modules 表默认记录
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ZodTypeAny } from "zod";

/** 报表模块元数据 —— 写入 report_modules 表 */
export interface ReportMeta {
  /** 模块唯一编码（下划线命名，如 pkg_wip_inproc_detail） */
  code: string;
  /** 显示名 */
  name: string;
  /** 分类（用于前端侧边栏分组） */
  category: string;
  /** 描述 */
  description: string;
  /** 前端路由 */
  route: string;
  /** 菜单图标（lucide 名称） */
  icon?: string;
  /** 侧边栏排序 */
  sortOrder: number;
}

/** Excel 列配置 */
export interface ExcelColumn<Row> {
  /** 表头 */
  header: string;
  /** 列宽 */
  width: number;
  /** 从数据行取值 */
  value: (row: Row) => string | number | null | undefined;
  /** 对齐方式 —— 默认数据列居中、前几列左对齐由 leftAlignCols 控制 */
  align?: "left" | "center" | "right";
  /** 若定义，则渲染合计行时该列显示此值；若任一列有 totalValue，则追加合计行 */
  totalValue?: (rows: Row[]) => string | number | "";
}

/** Excel 导出配置 */
export interface ExcelConfig<Row, Input> {
  /** 工作表名称 */
  sheetName: string;
  /** 标题行文本（首行合并单元格） */
  title: (input: Input) => string;
  /** 列配置（决定表头、数据、合并单元格范围） */
  columns: ExcelColumn<Row>[];
  /**
   * 下载文件名组成部分（不含扩展名），自动 join("_") + .xlsx
   * 例：["封装厂WIP汇总表", "2024-05-01"]
   */
  filenameParts: (input: Input) => string[];
  /**
   * 数据行前 N 列默认左对齐（其余居中）。默认 0。
   * 若某列显式指定了 align，则以列配置为准。
   */
  leftAlignCols?: number;
}

/** 通用 {rows,total} 返回结构 */
export interface QueryResult<Row> {
  rows: Row[];
  total: number;
}

/** 报表插件接口 */
export interface ReportPlugin<
  Row = unknown,
  Input = unknown,
  FilterInput = unknown,
  FilterOptions = unknown,
  QueryReturn = QueryResult<Row>,
  ExportReturn = Row[],
> {
  /** 元数据 */
  meta: ReportMeta;

  /** Zod schema —— query 过程 */
  inputSchema: ZodTypeAny;
  /** Zod schema —— exportData 过程 */
  exportInputSchema: ZodTypeAny;
  /** Zod schema —— filterOptions 过程（可选，部分报表无 filterOptions 或无参数） */
  filterOptionsInputSchema?: ZodTypeAny;

  /** 分页查询（ClickHouse） */
  query: (client: ClickHouseClient, input: Input) => Promise<QueryReturn>;
  /** 筛选项查询（ClickHouse） */
  filterOptions?: (client: ClickHouseClient, input: FilterInput) => Promise<FilterOptions>;
  /** 导出查询（ClickHouse） */
  exportQuery: (client: ClickHouseClient, input: Input) => Promise<ExportReturn>;

  /** 无 ClickHouse 数据源时的兜底 query 返回值 */
  emptyQueryResult: QueryReturn;
  /** 无 ClickHouse 数据源时的兜底 filterOptions 返回值 */
  emptyFilterOptions?: FilterOptions;
  /** 无 ClickHouse 数据源时的兜底 export 返回值 */
  emptyExportRows?: ExportReturn;

  /** Mock 实现（例如 pkg_wip_summary 需要带演示数据） */
  mockQuery?: (input: Input) => QueryReturn;
  mockFilterOptions?: (input: FilterInput) => FilterOptions;
  mockExport?: (input: Input) => ExportReturn;

  /**
   * 从导出查询返回值中提取数据行数组，供 Excel 渲染器使用。
   * 默认实现：若返回值是数组直接返回；否则读取 .data / .rows 字段。
   * pkg_wip_summary 的 exportQuery 返回 { data, totalRow }，需要自定义提取。
   */
  rowsForExcel?: (exported: ExportReturn) => Row[];

  /** Excel 导出配置 */
  excel: ExcelConfig<Row, Input>;
}
