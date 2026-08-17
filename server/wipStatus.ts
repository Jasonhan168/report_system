/**
 * WIP 日报接收状态模块
 *
 * - getWipDailyStatus: 查询当日全部供应商的日报接收状态（dim_vendor LEFT JOIN dwd_ab_wip_receive_status）
 * - updateWipDailyStatus: 外部解析系统在成功解析后写入接收状态
 * - registerWipStatusRoutes: 注册 REST POST /api/wip-daily-status/update 端点
 */
import type { Router } from "express";
import { getAllDatasources } from "./db";
import { getReportDbClient, getDorisPool } from "./datasource";
import type { Datasource } from "../drizzle/schema";
import { ENV } from "./_core/env";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

export interface VendorStatusRow {
  vendor_code: string;
  vendor_name: string;
  receive_time: string | null;
  status: number; // 0=未接收, 1=Loading..., 2=已接收
}

export interface WipDailyStatusSummary {
  received: number;
  total: number;
}

export interface WipDailyStatusResult {
  vendors: VendorStatusRow[];
  summary: WipDailyStatusSummary;
}

// ─── SQL 工具 ──────────────────────────────────────────────────────────────────

function escStr(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** 从全部数据源中找到第一个可用的 Doris 数据源 */
async function getDorisDatasource(): Promise<Datasource | undefined> {
  const all = await getAllDatasources();
  return all.find((ds) => ds.type === "doris" && ds.isActive);
}

// ─── 查询函数 ──────────────────────────────────────────────────────────────────

/** 查询当日全部供应商接收状态（含未接收） */
export async function getWipDailyStatus(date?: string): Promise<WipDailyStatusResult> {
  const ds = await getDorisDatasource();
  if (!ds) {
    return { vendors: [], summary: { received: 0, total: 0 } };
  }

  const client = getReportDbClient(ds);
  // date 参数为空时用 CURDATE() 取当天；传入时用字面值
  const dateCond = date ? `'${escStr(date)}'` : "CURDATE()";

  const sql = `
    SELECT
      v.vendor_code,
      v.vendor_name,
      s.data_time AS receive_time,
      COALESCE(s.update_status, 0) AS status
    FROM dim_vendor v
    LEFT JOIN dwd_ab_wip_receive_status s
      ON v.vendor_code = s.vendor_code
      AND s.\`date\` = ${dateCond}
    ORDER BY status DESC, v.vendor_name
  `;

  const rows = await client.query<VendorStatusRow>(sql);
  const received = rows.filter((r) => r.status === 2).length;

  return {
    vendors: rows,
    summary: { received, total: rows.length },
  };
}

// ─── 更新函数 ──────────────────────────────────────────────────────────────────

/** 写入日报接收状态（INSERT = upsert，由 Doris Unique Key 模型保证） */
export async function updateWipDailyStatus(params: {
  date: string;
  vendor_code: string;
  vendor_name: string;
  file_count: number;
}): Promise<void> {
  const ds = await getDorisDatasource();
  if (!ds) {
    throw new Error("未找到可用的 Doris 数据源");
  }

  const pool = getDorisPool(ds);
  await pool.query(
    "INSERT INTO dwd_ab_wip_receive_status (`date`, vendor_code, vendor_name, file_count, data_time) VALUES (?, ?, ?, ?, NOW())",
    [params.date, params.vendor_code, params.vendor_name, params.file_count],
  );
}

// ─── REST 路由注册 ─────────────────────────────────────────────────────────────

/** 注册 WIP 日报接收状态更新 REST 端点（供外部解析系统调用） */
export function registerWipStatusRoutes(app: Router) {
  app.post("/api/wip-daily-status/update", async (req, res) => {
    try {
      // API Key 鉴权
      const authHeader = req.headers.authorization ?? "";
      const apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!ENV.wipStatusApiKey || apiKey !== ENV.wipStatusApiKey) {
        res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
        return;
      }

      const { date, vendor_code, vendor_name, file_count } = req.body ?? {};

      // 参数校验
      if (!date || typeof date !== "string") {
        res.status(400).json({ error: "date is required" });
        return;
      }
      if (!vendor_code || typeof vendor_code !== "string") {
        res.status(400).json({ error: "vendor_code is required" });
        return;
      }
      if (!vendor_name || typeof vendor_name !== "string") {
        res.status(400).json({ error: "vendor_name is required" });
        return;
      }
      if (typeof file_count !== "number" || file_count < 0) {
        res.status(400).json({ error: "file_count must be a non-negative number" });
        return;
      }

      await updateWipDailyStatus({ date, vendor_code, vendor_name, file_count });
      console.log(`[WipStatus] Updated: ${vendor_code} (${vendor_name}) date=${date} file_count=${file_count}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[WipStatus] Update failed:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
    }
  });
}
