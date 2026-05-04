/**
 * 用户操作日志 helper
 *
 * 统一写入 operation_logs 表，并负责从 Express 请求提取 IP/UA。
 * 所有写入均为"尽力而为"：即使日志落库失败，也不能影响主业务流程。
 */
import type { Request } from "express";
import { insertOperationLog } from "../db";
import type { InsertOperationLog } from "../../drizzle/schema";

export type OperationAction =
  | "login"
  | "login_failed"
  | "logout"
  | "view"
  | "export"
  | "drill_down";

/** 从 Express Request 提取客户端 IP（支持反向代理） */
export function getClientIp(req: Request | undefined): string | null {
  if (!req) return null;
  const xff = (req.headers["x-forwarded-for"] as string | undefined) || "";
  const first = xff.split(",")[0]?.trim();
  const ip =
    first ||
    (req.headers["x-real-ip"] as string | undefined) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "";
  return ip ? ip.replace(/^::ffff:/, "") : null;
}

export function getUserAgent(req: Request | undefined): string | null {
  if (!req) return null;
  return (req.headers["user-agent"] as string | undefined) || null;
}

export interface LogOperationInput {
  user?: {
    id?: number | null;
    openId?: string | null;
    name?: string | null;
  } | null;
  action: OperationAction;
  resourceType?: string | null;
  resourceCode?: string | null;
  resourceName?: string | null;
  params?: unknown;
  req?: Request | null;
  success?: boolean;
  errorMsg?: string | null;
  durationMs?: number | null;
}

/** 统一写入一条操作日志（异步，静默失败） */
export async function logOperation(input: LogOperationInput): Promise<void> {
  const payload: InsertOperationLog = {
    userId: input.user?.id ?? null,
    userOpenId: input.user?.openId ?? null,
    userName: input.user?.name ?? null,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceCode: input.resourceCode ?? null,
    resourceName: input.resourceName ?? null,
    params: (input.params ?? null) as InsertOperationLog["params"],
    ip: getClientIp(input.req ?? undefined),
    userAgent: getUserAgent(input.req ?? undefined),
    success: input.success ?? true,
    errorMsg: input.errorMsg ?? null,
    durationMs: input.durationMs ?? null,
  };
  await insertOperationLog(payload);
}
