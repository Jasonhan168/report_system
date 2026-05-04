/**
 * 报表 Excel 导出路由（自动注册）
 *
 * 自动为 ALL_REPORTS 中每个插件注册 GET /api/export/<code-with-dashes>：
 *   - pkg_wip_summary       → /api/export/pkg-wip-summary
 *   - outsource_order_detail → /api/export/outsource-order-detail
 *   - ...
 */
import type { Request, Router } from "express";
import ExcelJS from "exceljs";
import { sdk } from "./_core/sdk";
import {
  checkUserReportPermission, getReportModuleByCode, getReportModuleDatasource,
  getAllUsers, listOperationLogsForExport,
} from "./db";
import { getClickHouseClient } from "./datasource";
import { ALL_REPORTS } from "./reports/_registry";
import { extractRows, renderExcel } from "./reports/_excel";
import { logOperation } from "./_core/operationLog";
import { COOKIE_NAME } from "@shared/const";

/** 从请求 cookie 解析当前用户 */
async function resolveUser(req: Request) {
  const cookieHeader = req.headers.cookie || "";
  const cookieMap = new Map(
    cookieHeader.split(";").map((c) => c.trim().split("=").map(decodeURIComponent) as [string, string])
  );
  const sessionToken = cookieMap.get(COOKIE_NAME);
  if (!sessionToken) return null;
  const payload = await sdk.verifySession(sessionToken);
  if (!payload) return null;
  const allUsers = await getAllUsers();
  const user = allUsers.find((u) => u.openId === payload.openId);
  if (!user || !user.isActive) return null;
  return user;
}

/** 下划线 code → 连字符 URL 段 */
function codeToPath(code: string): string {
  return code.replace(/_/g, "-");
}

/** 解析 Express query 为插件 input（自动保留字符串数组、过滤空串） */
function parseQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (Array.isArray(v)) {
      if (v.length > 0) out[k] = v as string[];
    } else if (typeof v === "string" && v !== "") {
      out[k] = v;
    }
  }
  return out;
}

export function registerExportRoutes(app: Router) {
  // ─── 管理员：导出用户操作日志 ─────────────────────────────────
  app.get("/api/export/operation-logs", async (req, res) => {
    const start = Date.now();
    let user: Awaited<ReturnType<typeof resolveUser>> = null;
    const input = parseQuery(req.query as Record<string, unknown>);
    let success = true;
    let errorMsg: string | null = null;
    try {
      user = await resolveUser(req);
      if (!user) {
        success = false;
        errorMsg = "未登录或会话已过期";
        res.status(401).json({ error: errorMsg });
        return;
      }
      if (user.role !== "admin") {
        success = false;
        errorMsg = "仅管理员可导出操作日志";
        res.status(403).json({ error: errorMsg });
        return;
      }

      const rows = await listOperationLogsForExport({
        action: typeof input.action === "string" ? (input.action as string) : undefined,
        resourceCode:
          typeof input.resourceCode === "string" ? (input.resourceCode as string) : undefined,
        keyword:
          typeof input.keyword === "string" ? (input.keyword as string) : undefined,
        startTime:
          typeof input.startTime === "string" ? new Date(input.startTime as string) : undefined,
        endTime:
          typeof input.endTime === "string" ? new Date(input.endTime as string) : undefined,
        limit: 50000,
      });

      await renderOperationLogExcel(rows, input, res);
    } catch (err) {
      success = false;
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[Export] operation-logs error:", err);
      if (!res.headersSent) res.status(500).json({ error: "导出失败，请重试" });
    } finally {
      logOperation({
        user: user ? { id: user.id, openId: user.openId, name: user.name } : null,
        action: "export",
        resourceType: "operation_log",
        resourceCode: "operation_logs",
        resourceName: "用户操作日志",
        params: input,
        req,
        success,
        errorMsg,
        durationMs: Date.now() - start,
      }).catch(() => {});
    }
  });

  for (const plugin of ALL_REPORTS) {
    const urlPath = `/api/export/${codeToPath(plugin.meta.code)}`;
    app.get(urlPath, async (req, res) => {
      const start = Date.now();
      let user: Awaited<ReturnType<typeof resolveUser>> = null;
      const input = parseQuery(req.query as Record<string, unknown>);
      let success = true;
      let errorMsg: string | null = null;
      try {
        user = await resolveUser(req);
        if (!user) {
          success = false;
          errorMsg = "未登录或会话已过期";
          res.status(401).json({ error: errorMsg });
          return;
        }

        if (user.role !== "admin") {
          const mod = await getReportModuleByCode(plugin.meta.code);
          if (!mod) {
            success = false;
            errorMsg = "无导出权限";
            res.status(403).json({ error: errorMsg });
            return;
          }
          const allowed = await checkUserReportPermission(user.id, mod.id, "export");
          if (!allowed) {
            success = false;
            errorMsg = "无导出权限";
            res.status(403).json({ error: errorMsg });
            return;
          }
        }

        const ds = await getReportModuleDatasource(plugin.meta.code);

        let exported: unknown;
        if (ds && ds.type === "clickhouse") {
          const client = getClickHouseClient(ds);
          exported = await plugin.exportQuery(client, input);
        } else if (plugin.mockExport) {
          exported = plugin.mockExport(input);
        } else {
          success = false;
          errorMsg = "数据源未配置";
          res.status(400).json({ error: errorMsg });
          return;
        }

        const rows = extractRows(plugin, exported);
        await renderExcel(plugin, rows, input, res);
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Export] ${plugin.meta.code} error:`, err);
        if (!res.headersSent) res.status(500).json({ error: "导出失败，请重试" });
      } finally {
        // 记录报表导出日志（含查询条件）
        logOperation({
          user: user ? { id: user.id, openId: user.openId, name: user.name } : null,
          action: "export",
          resourceType: "report",
          resourceCode: plugin.meta.code,
          resourceName: plugin.meta.name,
          params: input,
          req,
          success,
          errorMsg,
          durationMs: Date.now() - start,
        }).catch(() => {});
      }
    });
  }
}

// ─── 操作日志 Excel 渲染 ────────────────────────────────────────────
const OPERATION_LABELS: Record<string, string> = {
  login: "登录",
  login_failed: "登录失败",
  logout: "登出",
  view: "查看报表",
  export: "导出报表",
  drill_down: "下钻",
};

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

type OperationLogRow = Awaited<ReturnType<typeof listOperationLogsForExport>>[number];

async function renderOperationLogExcel(
  rows: OperationLogRow[],
  input: Record<string, unknown>,
  res: import("express").Response,
): Promise<void> {
  const columns: { header: string; width: number; value: (r: OperationLogRow) => string | number }[] = [
    { header: "时间", width: 20, value: (r) => formatDateTime(r.createdAt) },
    { header: "姓名", width: 14, value: (r) => r.userName ?? "" },
    { header: "账号", width: 18, value: (r) => r.userOpenId ?? "" },
    { header: "操作", width: 12, value: (r) => OPERATION_LABELS[r.action] ?? r.action },
    { header: "资源类型", width: 12, value: (r) => r.resourceType ?? "" },
    { header: "资源名称", width: 22, value: (r) => r.resourceName ?? "" },
    { header: "资源编码", width: 22, value: (r) => r.resourceCode ?? "" },
    { header: "查询参数", width: 40, value: (r) => (r.params == null ? "" : typeof r.params === "string" ? r.params : JSON.stringify(r.params)) },
    { header: "IP", width: 16, value: (r) => r.ip ?? "" },
    { header: "结果", width: 8, value: (r) => (r.success ? "成功" : "失败") },
    { header: "错误信息", width: 30, value: (r) => r.errorMsg ?? "" },
    { header: "耗时(ms)", width: 10, value: (r) => (r.durationMs == null ? "" : r.durationMs) },
    { header: "User Agent", width: 40, value: (r) => r.userAgent ?? "" },
  ];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("操作日志");

  // 标题行
  const lastLetter = colLetter(columns.length - 1);
  ws.mergeCells(`A1:${lastLetter}1`);
  const titleCell = ws.getCell("A1");
  const startLabel = typeof input.startTime === "string" ? (input.startTime as string).slice(0, 10) : "";
  const endLabel = typeof input.endTime === "string" ? (input.endTime as string).slice(0, 10) : "";
  const rangeLabel = startLabel && endLabel ? `（${startLabel} ~ ${endLabel}）` : "";
  titleCell.value = `用户操作日志${rangeLabel}`;
  titleCell.font = { bold: true, size: 14, name: "微软雅黑" };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // 表头行
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

  // 数据行
  rows.forEach((r, idx) => {
    const dataRow = ws.addRow(columns.map((c) => c.value(r)));
    dataRow.height = 18;
    const bg = idx % 2 === 0 ? "FFFFFFFF" : "FFF5F7FA";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataRow.eachCell((cell: any) => {
      cell.font = { size: 10, name: "微软雅黑" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
      cell.border = {
        top: { style: "hair", color: { argb: "FFE0E8F0" } },
        bottom: { style: "hair", color: { argb: "FFE0E8F0" } },
        left: { style: "hair", color: { argb: "FFE0E8F0" } },
        right: { style: "hair", color: { argb: "FFE0E8F0" } },
      };
    });
  });

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  ws.views = [{ state: "frozen", ySplit: 2 }];

  const suffix = [startLabel, endLabel].filter(Boolean).join("_");
  const baseName = suffix ? `操作日志_${suffix}` : "操作日志";
  const filename = encodeURIComponent(`${baseName}.xlsx`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  await wb.xlsx.write(res);
  res.end();
}

/** A=0, B=1, ... → Excel 列字母 */
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
