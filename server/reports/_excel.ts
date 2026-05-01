/**
 * 通用 Excel 渲染器
 *
 * 接受一个 ReportPlugin + 数据行 + input，生成包含：
 *   - 合并单元格的标题行（A1:<lastCol>1）
 *   - 深蓝底白字的表头行
 *   - 交替背景色的数据行
 *   - （可选）合计行（当至少一列声明了 totalValue）
 *
 * 并以 xlsx 格式写入 Express Response。
 */
import type { Response } from "express";
import ExcelJS from "exceljs";
import type { ExcelColumn, ReportPlugin } from "./_types";

/** A=0, B=1, ..., AA=26 ... 转 Excel 列字母 */
function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 判断是否需要追加合计行（至少一列声明 totalValue） */
function hasTotalRow<Row>(columns: ExcelColumn<Row>[]): boolean {
  return columns.some((c) => typeof c.totalValue === "function");
}

export async function renderExcel<Row, Input>(
  plugin: ReportPlugin<Row, Input, unknown, unknown, unknown, unknown>,
  rows: Row[],
  input: Input,
  res: Response,
): Promise<void> {
  const { excel, meta } = plugin;
  const columns = excel.columns;
  const lastColLetter = colLetter(columns.length - 1);
  const leftAlignCols = excel.leftAlignCols ?? 0;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(excel.sheetName);

  // ─── 标题行（合并单元格）──────────────────────────────────────────────
  ws.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = excel.title(input);
  titleCell.font = { bold: true, size: 14, name: "微软雅黑" };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // ─── 表头行 ────────────────────────────────────────────────────────────
  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.height = 22;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headerRow.eachCell((cell: any) => {
    cell.font = { bold: true, size: 10, name: "微软雅黑", color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB8C8E0" } },
      bottom: { style: "thin", color: { argb: "FFB8C8E0" } },
      left: { style: "thin", color: { argb: "FFB8C8E0" } },
      right: { style: "thin", color: { argb: "FFB8C8E0" } },
    };
  });

  // ─── 数据行 ────────────────────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const vals = columns.map((c) => {
      const v = c.value(row);
      return v === null || v === undefined ? "" : v;
    });
    const dataRow = ws.addRow(vals);
    dataRow.height = 18;
    const bgColor = idx % 2 === 0 ? "FFFFFFFF" : "FFF5F7FA";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataRow.eachCell((cell: any, colNum: number) => {
      const colCfg = columns[colNum - 1];
      const align =
        colCfg?.align ??
        (colNum <= leftAlignCols ? "left" : "center");
      cell.font = { size: 10, name: "微软雅黑" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.alignment = { horizontal: align, vertical: "middle" };
      cell.border = {
        top: { style: "hair", color: { argb: "FFE0E8F0" } },
        bottom: { style: "hair", color: { argb: "FFE0E8F0" } },
        left: { style: "hair", color: { argb: "FFE0E8F0" } },
        right: { style: "hair", color: { argb: "FFE0E8F0" } },
      };
    });
  });

  // ─── 合计行（可选）─────────────────────────────────────────────────────
  if (rows.length > 0 && hasTotalRow(columns)) {
    const totalVals = columns.map((c, i) => {
      if (c.totalValue) return c.totalValue(rows);
      if (i === 0) return "合计";
      return "";
    });
    const sumRow = ws.addRow(totalVals);
    sumRow.height = 20;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sumRow.eachCell((cell: any) => {
      cell.font = { bold: true, size: 10, name: "微软雅黑" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FF1E3A5F" } },
        bottom: { style: "thin", color: { argb: "FF1E3A5F" } },
        left: { style: "thin", color: { argb: "FFB8C8E0" } },
        right: { style: "thin", color: { argb: "FFB8C8E0" } },
      };
    });
  }

  // ─── 列宽 / 冻结 ───────────────────────────────────────────────────────
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  ws.views = [{ state: "frozen", ySplit: 2 }];

  // ─── 文件名 / 响应头 ───────────────────────────────────────────────────
  const parts = excel.filenameParts(input).filter(Boolean);
  const baseName = parts.length > 0 ? parts.join("_") : meta.name;
  const filename = encodeURIComponent(`${baseName}.xlsx`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  await wb.xlsx.write(res);
  res.end();
}

/** 从插件 exportQuery 返回值中提取数据行数组 */
export function extractRows<Row, ExportReturn>(
  plugin: { rowsForExcel?: (exported: ExportReturn) => Row[] },
  exported: ExportReturn,
): Row[] {
  if (plugin.rowsForExcel) return plugin.rowsForExcel(exported);
  if (Array.isArray(exported)) return exported as unknown as Row[];
  const maybe = exported as unknown as { data?: Row[]; rows?: Row[] };
  if (Array.isArray(maybe?.data)) return maybe.data;
  if (Array.isArray(maybe?.rows)) return maybe.rows;
  return [];
}
