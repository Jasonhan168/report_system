/**
 * 报表插件 → tRPC 子路由构建器
 *
 * 每个插件通过本函数即可生成标准的四个过程：
 *   - checkPermission: 权限检查
 *   - filterOptions:   筛选项（可选）
 *   - query:           分页数据查询
 *   - exportData:      导出数据（全量）
 *
 * 内部统一处理权限校验、ClickHouse / Mock 路由。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getReportModuleByCode, checkUserReportPermission, getReportModuleDatasource } from "../db";
import { getClickHouseClient } from "../datasource";
import { logOperation } from "../_core/operationLog";
import type { ReportPlugin } from "./_types";

/** 权限检查辅助函数：管理员放行；否则查 report_modules + report_permissions */
async function assertPermission(
  user: { id: number; role: string },
  code: string,
  type: "view" | "export",
  errMsg: string,
) {
  if (user.role === "admin") return;
  const mod = await getReportModuleByCode(code);
  if (!mod) throw new TRPCError({ code: "FORBIDDEN", message: errMsg });
  const allowed = await checkUserReportPermission(user.id, mod.id, type);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: errMsg });
}

/** 生成标准的报表 tRPC 子路由 */
export function makeReportRouter<
  Row,
  Input,
  FilterInput,
  FilterOptions,
  QueryReturn,
  ExportReturn,
>(p: ReportPlugin<Row, Input, FilterInput, FilterOptions, QueryReturn, ExportReturn>) {
  const { code } = p.meta;

  const filterInputSchema = p.filterOptionsInputSchema ?? z.void();

  return router({
    // ─── 权限检查 ──────────────────────────────────────────────────────────
    checkPermission: protectedProcedure
      .input(z.object({ type: z.enum(["view", "export"]) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role === "admin") return { allowed: true };
        const mod = await getReportModuleByCode(code);
        if (!mod) return { allowed: false };
        const allowed = await checkUserReportPermission(ctx.user.id, mod.id, input.type);
        return { allowed };
      }),

    // ─── 筛选项 ────────────────────────────────────────────────────────────
    filterOptions: protectedProcedure
      .input(filterInputSchema)
      .query(async ({ ctx, input }) => {
        await assertPermission(ctx.user, code, "view", "无查看权限");
        const ds = await getReportModuleDatasource(code);
        if (ds && ds.type === "clickhouse" && p.filterOptions) {
          const client = getClickHouseClient(ds);
          return p.filterOptions(client, input as FilterInput);
        }
        if (p.mockFilterOptions) {
          return p.mockFilterOptions(input as FilterInput);
        }
        return p.emptyFilterOptions ?? ({} as FilterOptions);
      }),

    // ─── 分页查询 ──────────────────────────────────────────────────────────
    query: protectedProcedure
      .input(p.inputSchema)
      .query(async ({ ctx, input }) => {
        await assertPermission(ctx.user, code, "view", "无查看权限");
        const ds = await getReportModuleDatasource(code);
        const start = Date.now();
        let success = true;
        let errorMsg: string | null = null;
        try {
          if (ds && ds.type === "clickhouse") {
            const client = getClickHouseClient(ds);
            return await p.query(client, input as Input);
          }
          if (p.mockQuery) {
            return p.mockQuery(input as Input);
          }
          return p.emptyQueryResult;
        } catch (err) {
          success = false;
          errorMsg = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          // 记录报表查看日志（含查询条件）
          logOperation({
            user: ctx.user,
            action: "view",
            resourceType: "report",
            resourceCode: code,
            resourceName: p.meta.name,
            params: input,
            req: ctx.req,
            success,
            errorMsg,
            durationMs: Date.now() - start,
          }).catch(() => {});
        }
      }),

    // ─── 导出数据 ──────────────────────────────────────────────────────────
    exportData: protectedProcedure
      .input(p.exportInputSchema)
      .query(async ({ ctx, input }) => {
        await assertPermission(ctx.user, code, "export", "无导出权限");
        const ds = await getReportModuleDatasource(code);
        if (ds && ds.type === "clickhouse") {
          const client = getClickHouseClient(ds);
          return p.exportQuery(client, input as Input);
        }
        if (p.mockExport) {
          return p.mockExport(input as Input);
        }
        return (p.emptyExportRows ?? []) as ExportReturn;
      }),
  });
}
