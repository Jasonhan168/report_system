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
import { getReportModuleDatasource } from "../db";
import { getReportDbClient } from "../datasource";
import { logOperation } from "../_core/operationLog";
import type { ReportPlugin } from "./_types";
import { authorizeReport, constrainPlant } from "../reportAccess";

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

  const plantSchema = z.object({ plant: z.string().max(128).optional() });
  const filterInputSchema = p.filterOptionsInputSchema
    ? p.filterOptionsInputSchema.and(plantSchema)
    : plantSchema.optional();

  return router({
    // ─── 权限检查 ──────────────────────────────────────────────────────────
    checkPermission: protectedProcedure
      .input(z.object({ type: z.enum(["view", "export"]) }))
      .query(async ({ ctx, input }) => {
        try { await authorizeReport(ctx.user, code, input.type); return { allowed: true }; }
        catch (error) {
          if (error instanceof TRPCError && error.code === "FORBIDDEN") return { allowed: false };
          throw error;
        }
      }),

    // ─── 筛选项 ────────────────────────────────────────────────────────────
    filterOptions: protectedProcedure
      .input(filterInputSchema)
      .query(async ({ ctx, input }) => {
        const access = constrainPlant(await authorizeReport(ctx.user, code, "view"), input);
        const ds = await getReportModuleDatasource(code);
        if (ds && (ds.type === "clickhouse" || ds.type === "doris") && p.filterOptions) {
          const client = getReportDbClient(ds);
          return p.filterOptions(client, input as FilterInput, access);
        }
        if (access.scope === "all" && p.mockFilterOptions) {
          return p.mockFilterOptions(input as FilterInput);
        }
        return p.emptyFilterOptions ?? ({} as FilterOptions);
      }),

    // ─── 分页查询 ──────────────────────────────────────────────────────────
    query: protectedProcedure
      .input(p.inputSchema.and(z.object({ plant: z.string().max(128).optional() })))
      .query(async ({ ctx, input }) => {
        const access = constrainPlant(await authorizeReport(ctx.user, code, "view"), input);
        const ds = await getReportModuleDatasource(code);
        const start = Date.now();
        let success = true;
        let errorMsg: string | null = null;
        try {
          if (ds && (ds.type === "clickhouse" || ds.type === "doris")) {
            const client = getReportDbClient(ds);
            return await p.query(client, input as Input, access);
          }
          if (access.scope === "all" && p.mockQuery) {
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
            params: { input, effectiveScope: access },
            req: ctx.req,
            success,
            errorMsg,
            durationMs: Date.now() - start,
          }).catch(() => {});
        }
      }),

    // ─── 导出数据 ──────────────────────────────────────────────────────────
    exportData: protectedProcedure
      .input(p.exportInputSchema.and(z.object({ plant: z.string().max(128).optional() })))
      .query(async ({ ctx, input }) => {
        const access = constrainPlant(await authorizeReport(ctx.user, code, "export"), input);
        const start = Date.now();
        let errorMsg: string | null = null;
        try {
          const ds = await getReportModuleDatasource(code);
          if (ds && (ds.type === "clickhouse" || ds.type === "doris")) {
            return await p.exportQuery(getReportDbClient(ds), input as Input, access);
          }
          if (access.scope === "all" && p.mockExport) return p.mockExport(input as Input);
          return (p.emptyExportRows ?? []) as ExportReturn;
        } catch (error) {
          errorMsg = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          logOperation({ user: ctx.user, action: "export", resourceType: "report", resourceCode: code,
            resourceName: p.meta.name, params: { input, effectiveScope: access }, req: ctx.req,
            success: errorMsg === null, errorMsg, durationMs: Date.now() - start }).catch(() => {});
        }
      }),
  });
}
