/**
 * 报表 Excel 导出路由（自动注册）
 *
 * 自动为 ALL_REPORTS 中每个插件注册 GET /api/export/<code-with-dashes>：
 *   - pkg_wip_summary       → /api/export/pkg-wip-summary
 *   - outsource_order_detail → /api/export/outsource-order-detail
 *   - ...
 */
import type { Request, Router } from "express";
import { sdk } from "./_core/sdk";
import { checkUserReportPermission, getReportModuleByCode, getReportModuleDatasource, getAllUsers } from "./db";
import { getClickHouseClient } from "./datasource";
import { ALL_REPORTS } from "./reports/_registry";
import { extractRows, renderExcel } from "./reports/_excel";
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
  for (const plugin of ALL_REPORTS) {
    const urlPath = `/api/export/${codeToPath(plugin.meta.code)}`;
    app.get(urlPath, async (req, res) => {
      try {
        const user = await resolveUser(req);
        if (!user) { res.status(401).json({ error: "未登录或会话已过期" }); return; }

        if (user.role !== "admin") {
          const mod = await getReportModuleByCode(plugin.meta.code);
          if (!mod) { res.status(403).json({ error: "无导出权限" }); return; }
          const allowed = await checkUserReportPermission(user.id, mod.id, "export");
          if (!allowed) { res.status(403).json({ error: "无导出权限" }); return; }
        }

        const input = parseQuery(req.query as Record<string, unknown>);
        const ds = await getReportModuleDatasource(plugin.meta.code);

        let exported: unknown;
        if (ds && ds.type === "clickhouse") {
          const client = getClickHouseClient(ds);
          exported = await plugin.exportQuery(client, input);
        } else if (plugin.mockExport) {
          exported = plugin.mockExport(input);
        } else {
          res.status(400).json({ error: "数据源未配置" });
          return;
        }

        const rows = extractRows(plugin, exported);
        await renderExcel(plugin, rows, input, res);
      } catch (err) {
        console.error(`[Export] ${plugin.meta.code} error:`, err);
        if (!res.headersSent) res.status(500).json({ error: "导出失败，请重试" });
      }
    });
  }
}
