import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";
import { getCompany } from "./accounts";
import { checkUserReportPermission, getReportModuleByCode } from "./db";

export type ReportAccessContext =
  | { scope: "all" }
  | { scope: "own"; plant: string };

export async function resolveDataScope(
  user: User
): Promise<ReportAccessContext> {
  if (!user.isActive)
    throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  if (user.dataScope === "all") return { scope: "all" };
  if (user.dataScope === "own" && user.companyId) {
    const company = await getCompany(user.companyId);
    if (company?.isActive && company.plant)
      return { scope: "own", plant: company.plant };
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "尚未分配有效的分公司数据范围，请联系管理员",
  });
}

export async function hasDataScope(user: User) {
  try {
    await resolveDataScope(user);
    return true;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") return false;
    throw error;
  }
}

export async function authorizeReport(
  user: User,
  code: string,
  type: "view" | "export"
) {
  const access = await resolveDataScope(user);
  if (user.role !== "admin") {
    const mod = await getReportModuleByCode(code);
    if (
      !mod?.isActive ||
      !(await checkUserReportPermission(user.id, mod.id, type))
    )
      throw new TRPCError({ code: "FORBIDDEN", message: "无报表操作权限" });
  }
  return access;
}

export function constrainPlant(
  access: ReportAccessContext,
  input: unknown
): ReportAccessContext {
  const plant =
    input && typeof input === "object" && "plant" in input
      ? input.plant
      : undefined;
  if (plant === undefined || plant === "") return access;
  if (typeof plant !== "string")
    throw new TRPCError({ code: "BAD_REQUEST", message: "分公司参数不正确" });
  if (access.scope === "own" && plant !== access.plant)
    throw new TRPCError({ code: "FORBIDDEN", message: "无权查询其他分公司" });
  return { scope: "own", plant };
}

export function requireAllScope(user: User) {
  if (!user.isActive || user.dataScope !== "all")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "此看板仅对全范围用户开放",
    });
}
