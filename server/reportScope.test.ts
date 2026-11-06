import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "express";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { ALL_REPORTS } from "./reports/_registry";
import { makeReportRouter } from "./reports/_makeRouter";
import { scopedSource } from "./reports/_scope";
import {
  authorizeReport,
  constrainPlant,
  resolveDataScope,
} from "./reportAccess";
import { registerExportRoutes } from "./export";
import { appRouter } from "./routers";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import * as accounts from "./accounts";
import * as datasource from "./datasource";
import * as excel from "./reports/_excel";
import * as logs from "./_core/operationLog";

const user = (scope: User["dataScope"] = "own", companyId = 1): User => ({
  id: 10,
  openId: "tester",
  name: "测试账号",
  email: null,
  loginMethod: "local",
  authType: "local",
  role: "user",
  companyId,
  dataScope: scope,
  sessionVersion: 1,
  isActive: true,
  passwordHash: null,
  department: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
});
const context = (u: User): TrpcContext => ({
  user: u,
  req: { headers: {} } as any,
  res: {} as any,
});
let sqls: string[] = [];
let engine: "doris" | "clickhouse" = "doris";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sqls = [];
  vi.spyOn(db, "getReportModuleByCode").mockResolvedValue({
    id: 1,
    isActive: true,
  } as any);
  vi.spyOn(db, "checkUserReportPermission").mockResolvedValue(true);
  vi.spyOn(db, "getReportModuleDatasource").mockResolvedValue({
    id: 1,
    type: "doris",
  } as any);
  vi.spyOn(accounts, "getCompany").mockImplementation(async id => ({
    id,
    plant: id === 1 ? "A" : "B",
    name: "公司",
    isActive: true,
  }));
  vi.spyOn(datasource, "getReportDbClient").mockImplementation(() => ({
    engineType: engine,
    query: async sql => {
      sqls.push(sql);
      return [];
    },
  }));
  vi.spyOn(logs, "logOperation").mockResolvedValue();
});

describe("权限上下文", () => {
  it("拒绝待授权、停用和无所属公司账号", async () => {
    for (const u of [
      user("none"),
      { ...user(), isActive: false },
      { ...user(), companyId: null },
    ]) {
      await expect(resolveDataScope(u)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
  it("公司停用或数据库错误不能放宽范围", async () => {
    vi.mocked(accounts.getCompany).mockResolvedValue({
      id: 1,
      plant: "A",
      name: "公司",
      isActive: false,
    });
    await expect(resolveDataScope(user())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    vi.mocked(accounts.getCompany).mockRejectedValue(new Error("数据库故障"));
    await expect(resolveDataScope(user())).rejects.toThrow("数据库故障");
  });
  it("业务条件与授权范围取交集", () => {
    expect(constrainPlant({ scope: "own", plant: "A" }, {})).toEqual({
      scope: "own",
      plant: "A",
    });
    expect(() =>
      constrainPlant({ scope: "own", plant: "A" }, { plant: "B" })
    ).toThrow();
    expect(constrainPlant({ scope: "all" }, { plant: "A" })).toEqual({
      scope: "own",
      plant: "A",
    });
  });
  it("全范围普通用户没有管理权限，且仍需报表授权", async () => {
    await expect(
      appRouter.createCaller(context(user("all"))).companies.list()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(db.checkUserReportPermission).mockResolvedValue(false);
    await expect(
      authorizeReport(user("all"), "pkg_wip_summary", "view")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("模块入口只显示启用且已授权的报表", async () => {
    vi.spyOn(db, "getAllReportModules").mockResolvedValue([
      { id: 1, isActive: true },
      { id: 2, isActive: false },
    ] as any);
    vi.spyOn(db, "getPermissionsByUserId").mockResolvedValue([
      { reportModuleId: 1, canView: true },
      { reportModuleId: 2, canView: true },
    ] as any);
    const modules = await appRouter
      .createCaller(context(user("all")))
      .reportModules.list();
    expect(modules.map(m => m.id)).toEqual([1]);
  });
  it("看板拒绝 own / none，待授权无模块入口", async () => {
    for (const scope of ["own", "none"] as const)
      await expect(
        appRouter.createCaller(context(user(scope))).wipDailyStatus.list({})
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await appRouter.createCaller(context(user("none"))).reportModules.list()
    ).toEqual([]);
    expect(
      await appRouter
        .createCaller(context(user("none")))
        .permissions.myPermissions()
    ).toEqual([]);
  });
  it("唯一归属在完整历史中判断，空值/多归属拒绝，IN 不放大明细", () => {
    const sql = scopedSource("v_dws_ab_wip", { scope: "own", plant: "A'\\" });
    expect(sql).toContain("WHERE order_no IN (");
    expect(sql).toContain("GROUP BY order_no");
    expect(sql).toContain("min(ifNull(plant, ''))");
    expect(sql).toContain("max(ifNull(plant, ''))");
    expect(sql).not.toMatch(
      /received_rate|order_status|today\(|WHERE plant|JOIN/
    );
    expect(sql).toContain("A\\'\\\\");
    expect(scopedSource("v_dws_ab_wip", { scope: "all" })).toBe("v_dws_ab_wip");
    expect(() => scopedSource("v_dws_ab_wip", undefined as any)).toThrow();
  });
});

for (const plugin of ALL_REPORTS) {
  describe(plugin.meta.code, () => {
    for (const dbEngine of ["doris", "clickhouse"] as const) {
      for (const companyId of [1, 2])
        it(`${dbEngine} 公司${companyId}查询/计数/合计/筛选/导出全部受限`, async () => {
          engine = dbEngine;
          const caller = makeReportRouter(plugin).createCaller(
            context(user("own", companyId))
          );
          await caller.query({
            date: "2026-09-01",
            page: 1,
            pageSize: 5,
          } as any);
          await caller.filterOptions({ date: "2026-09-01" } as any);
          await caller.exportData({ date: "2026-09-01" } as any);
          expect(sqls.length).toBeGreaterThanOrEqual(3);
          const plant = companyId === 1 ? "A" : "B";
          for (const sql of sqls) {
            expect(sql).toContain(`min(ifNull(plant, '')) = '${plant}'`);
            expect(sql).toContain(`max(ifNull(plant, '')) = '${plant}'`);
            // 所有业务源要么被包装，要么是唯一归属子查询本身。
            const stripped = sql.replace(
              /\(SELECT \* FROM v_\w+ WHERE order_no IN \(\s*SELECT order_no FROM v_dwd_order\s*WHERE ifNull\(order_no, ''\) != ''\s*GROUP BY order_no\s*HAVING min\(ifNull\(plant, ''\)\) = '[AB]' AND max\(ifNull\(plant, ''\)\) = '[AB]'\s*\)\)/g,
              "scoped_view"
            );
            expect(stripped).not.toMatch(/(?:FROM|JOIN)\s+v_(?:dwd|dws)_/i);
          }
          expect(logs.logOperation).toHaveBeenCalledWith(
            expect.objectContaining({
              action: "export",
              params: expect.objectContaining({
                effectiveScope: { scope: "own", plant },
              }),
            })
          );
        });
    }
    it("全范围保留原始视图查询", async () => {
      await makeReportRouter(plugin)
        .createCaller(context(user("all")))
        .query({ date: "2026-09-01" } as any);
      expect(sqls.length).toBeGreaterThan(0);
      expect(sqls.join(" ")).not.toContain("min(ifNull(plant");
    });
    it("查询、筛选、tRPC 导出均拒绝待授权和伪造分公司", async () => {
      for (const scope of ["none", "own"] as const) {
        const caller = makeReportRouter(plugin).createCaller(
          context(user(scope))
        );
        for (const method of [
          "query",
          "filterOptions",
          "exportData",
        ] as const) {
          await expect(
            caller[method]({ plant: "B", date: "2026-09-01" } as any)
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
      }
      expect(sqls).toEqual([]);
    });
    it("本公司 Mock 不返回全局示例数据", async () => {
      vi.mocked(db.getReportModuleDatasource).mockResolvedValue({
        type: "mock",
      } as any);
      const caller = makeReportRouter(plugin).createCaller(context(user()));
      const query = await caller.query({ date: "2026-09-01" } as any);
      expect(query).toEqual(plugin.emptyQueryResult);
      expect(await caller.filterOptions({ date: "2026-09-01" } as any)).toEqual(
        plugin.emptyFilterOptions ?? {}
      );
      expect(sqls).toEqual([]);
    });
    it("REST 导出校验与 tRPC 相同", async () => {
      const handlers = new Map<string, Function>();
      registerExportRoutes({
        get: (path: string, handler: Function) => handlers.set(path, handler),
      } as unknown as Router);
      const handler = handlers.get(
        `/api/export/${plugin.meta.code.replace(/_/g, "-")}`
      )!;
      vi.spyOn(excel, "renderExcel").mockResolvedValue();
      const auth = vi.spyOn(sdk, "authenticateLocalRequest");
      for (const [u, input, status] of [
        [user("none"), {}, 403],
        [user(), { plant: "B" }, 403],
        [user(), { plant: ["A", "B"] }, 400],
        [user(), { plant: { value: "B" } }, 400],
        [user(), { plant: "A", date: "2026-09-01" }, 200],
      ] as const) {
        auth.mockResolvedValue(u);
        const res = {
          statusCode: 200,
          headersSent: false,
          status: vi.fn(function (this: any, n: number) {
            this.statusCode = n;
            return this;
          }),
          json: vi.fn(),
        };
        await handler(
          { query: { date: "2026-09-01", ...input }, headers: {} },
          res
        );
        expect(res.statusCode).toBe(status);
      }
      expect(excel.renderExcel).toHaveBeenCalledTimes(1);
      expect(
        sqls.every(sql => sql.includes("min(ifNull(plant, '')) = 'A'"))
      ).toBe(true);
    });
  });
}

it("单个订单号 REST 参数保留为数组，查询仍受公司约束", async () => {
  const handlers = new Map<string, Function>();
  registerExportRoutes({
    get: (path: string, handler: Function) => handlers.set(path, handler),
  } as unknown as Router);
  vi.spyOn(sdk, "authenticateLocalRequest").mockResolvedValue(user());
  vi.spyOn(excel, "renderExcel").mockResolvedValue();
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    headersSent: false,
  };
  await handlers.get("/api/export/outsource-order-detail")!(
    { query: { orderNos: "foreign-order" }, headers: {} },
    res
  );
  expect(res.status).not.toHaveBeenCalled();
  expect(sqls.every(sql => sql.includes("min(ifNull(plant, '')) = 'A'"))).toBe(
    true
  );
  expect(sqls.join(" ")).toContain("foreign-order");
});
