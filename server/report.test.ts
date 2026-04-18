import { describe, it, expect } from "vitest";
import { generateMockWipData, generateMockFilterOptions } from "./mockData";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock数据测试 ──────────────────────────────────────────────────────────────
describe("generateMockWipData", () => {
  it("应返回正确的数据结构", () => {
    const result = generateMockWipData({ date: "2024-01-15", page: 1, pageSize: 20 });
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("totalRow");
    expect(Array.isArray(result.data)).toBe(true);
  });

  it("每条记录应包含所有必要字段", () => {
    const result = generateMockWipData({ date: "2024-01-15", page: 1, pageSize: 5 });
    const row = result.data[0];
    expect(row).toHaveProperty("label_name");
    expect(row).toHaveProperty("vendor_part_no");
    expect(row).toHaveProperty("vendor_name");
    expect(row).toHaveProperty("unissued_qty");
    expect(row).toHaveProperty("die_attach");
    expect(row).toHaveProperty("wire_bond");
    expect(row).toHaveProperty("molding");
    expect(row).toHaveProperty("testing");
    expect(row).toHaveProperty("test_done");
    expect(row).toHaveProperty("wip_qty");
  });

  it("分页应正确工作", () => {
    const page1 = generateMockWipData({ date: "2024-01-15", page: 1, pageSize: 5 });
    const page2 = generateMockWipData({ date: "2024-01-15", page: 2, pageSize: 5 });
    expect(page1.data.length).toBeLessThanOrEqual(5);
    expect(page2.data.length).toBeLessThanOrEqual(5);
  });

  it("按标签品名筛选应正确工作", () => {
    const result = generateMockWipData({ date: "2024-01-15", labelName: "XC7A35T", page: 1, pageSize: 100 });
    result.data.forEach((row) => {
      expect(row.label_name.toLowerCase()).toContain("xc7a35t");
    });
  });

  it("按供应商筛选应正确工作", () => {
    const result = generateMockWipData({ date: "2024-01-15", vendorName: "深圳华威", page: 1, pageSize: 100 });
    result.data.forEach((row) => {
      expect(row.vendor_name).toContain("深圳华威");
    });
  });

  it("合计行wip_qty应等于所有数据之和", () => {
    const result = generateMockWipData({ date: "2024-01-15", page: 1, pageSize: 99999 });
    const sumWip = result.data.reduce((s, r) => s + r.wip_qty, 0);
    expect(result.totalRow.wip_qty).toBe(sumWip);
  });

  it("相同日期应返回相同数据（确定性）", () => {
    const r1 = generateMockWipData({ date: "2024-06-01", page: 1, pageSize: 10 });
    const r2 = generateMockWipData({ date: "2024-06-01", page: 1, pageSize: 10 });
    expect(r1.data).toEqual(r2.data);
  });

  it("不同日期应返回不同总量", () => {
    const r1 = generateMockWipData({ date: "2024-01-01", page: 1, pageSize: 99999 });
    const r2 = generateMockWipData({ date: "2024-12-31", page: 1, pageSize: 99999 });
    expect(r1.totalRow.wip_qty).not.toBe(r2.totalRow.wip_qty);
  });
});

describe("generateMockFilterOptions", () => {
  it("应返回标签品名和供应商列表", () => {
    const opts = generateMockFilterOptions("2024-01-15");
    expect(Array.isArray(opts.labelNames)).toBe(true);
    expect(Array.isArray(opts.vendorNames)).toBe(true);
    expect(opts.labelNames.length).toBeGreaterThan(0);
    expect(opts.vendorNames.length).toBeGreaterThan(0);
  });
});

// ─── 路由测试 ──────────────────────────────────────────────────────────────────
function createAdminCtx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-001", name: "管理员", email: "admin@example.com",
      loginMethod: "local", role: "admin", isActive: true,
      department: null, passwordHash: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("auth.logout", () => {
  it("应清除会话Cookie并返回成功", async () => {
    const clearedCookies: string[] = [];
    const ctx: TrpcContext = {
      user: {
        id: 1, openId: "test-user", name: "Test", email: null,
        loginMethod: "local", role: "user", isActive: true,
        department: null, passwordHash: null,
        createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string) => { clearedCookies.push(name); },
      } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBe(1);
  });
});

describe("pkgWipSummary.checkPermission", () => {
  it("管理员应有查看权限", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.pkgWipSummary.checkPermission({ type: "view" });
    expect(result.allowed).toBe(true);
  });

  it("管理员应有导出权限", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.pkgWipSummary.checkPermission({ type: "export" });
    expect(result.allowed).toBe(true);
  });
});

describe("pkgWipSummary.filterOptions", () => {
  it("管理员应能获取筛选选项", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.pkgWipSummary.filterOptions({ date: "2024-01-15" });
    expect(result.labelNames.length).toBeGreaterThan(0);
    expect(result.vendorNames.length).toBeGreaterThan(0);
  });
});

describe("pkgWipSummary.query", () => {
  it("管理员应能查询WIP数据", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.pkgWipSummary.query({ date: "2024-01-15", page: 1, pageSize: 10 });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.totalRow).toBeDefined();
  });

  it("查询结果应包含正确字段", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.pkgWipSummary.query({ date: "2024-01-15", page: 1, pageSize: 5 });
    const row = result.data[0];
    expect(row).toHaveProperty("label_name");
    expect(row).toHaveProperty("wip_qty");
    expect(typeof row.wip_qty).toBe("number");
  });

  it("分页参数应正确限制返回数量", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.pkgWipSummary.query({ date: "2024-01-15", page: 1, pageSize: 3 });
    expect(result.data.length).toBeLessThanOrEqual(3);
  });
});
