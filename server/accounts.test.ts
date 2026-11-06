import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, operationLogs, users, type User } from "../drizzle/schema";
import * as db from "./db";
import {
  accountInput,
  saveAccount,
  registerAdAccount,
  changeAccountPassword,
  saveCompany,
  localPasswordInput,
} from "./accounts";

const base: User = {
  id: 2,
  openId: "tester",
  name: "测试",
  email: null,
  department: null,
  loginMethod: "ldap",
  authType: "ldap",
  role: "user",
  companyId: null,
  dataScope: "none",
  sessionVersion: 1,
  passwordHash: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const actor = {
  ...base,
  id: 1,
  openId: "admin",
  role: "admin",
  dataScope: "all",
  authType: "local",
} as User;
const input = () =>
  accountInput.parse({
    userId: 2,
    username: "tester",
    displayName: "测试",
    role: "user",
    authType: "ldap",
    companyId: null,
    dataScope: "none",
  });

// 最小事务适配器：用确定的查询返回值验证写入内容，不接触真实数据库。
function fakeDb(results: unknown[][]) {
  const writes: { table: unknown; value: any }[] = [];
  const updates: { table: unknown; value: any }[] = [];
  const adapter = {
    select: vi.fn(() => {
      const result = results.shift() ?? [];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        for: async () => result,
        limit: async () => result,
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return chain;
    }),
    insert: vi.fn(table => ({
      values: async (value: any) => {
        writes.push({ table, value });
      },
    })),
    update: vi.fn(table => ({
      set: (value: any) => ({
        where: async () => {
          updates.push({ table, value });
        },
      }),
    })),
    transaction: vi.fn(async (fn: Function) => fn(adapter)),
  };
  vi.spyOn(db, "getDb").mockResolvedValue(adapter as any);
  return { adapter, writes, updates };
}
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("账号安全变更", () => {
  it("新建本地或从 AD 切换本地必须提供密码", async () => {
    fakeDb([[base]]);
    await expect(
      saveAccount({ ...input(), authType: "local" }, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("本地切 AD 清除密码，并撤销会话且写安全审计", async () => {
    const { writes, updates, adapter } = fakeDb([
      [{ ...base, authType: "local", passwordHash: "old-hash" }],
    ]);
    await saveAccount(input(), actor);
    expect(adapter.transaction).toHaveBeenCalledTimes(1);
    expect(updates[0].value).toMatchObject({
      authType: "ldap",
      passwordHash: null,
    });
    expect(updates[0].value.sessionVersion).toBeDefined();
    expect(writes.find(w => w.table === operationLogs)?.value).toMatchObject({
      resourceType: "security",
      userId: actor.id,
    });
    expect(JSON.stringify(writes.map(w => w.value))).not.toContain("old-hash");
  });
  it("own 必须选择有效公司，管理员必须 all", async () => {
    fakeDb([[{ id: 1, isActive: false }]]);
    await expect(
      saveAccount({ ...input(), dataScope: "own" }, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      saveAccount({ ...input(), dataScope: "own", companyId: 1 }, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      saveAccount({ ...input(), role: "admin" }, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("改密码只对 local 生效，版本变化拒绝过期请求", async () => {
    fakeDb([[base], [{ ...base, authType: "local", sessionVersion: 2 }]]);
    await expect(
      changeAccountPassword(2, "new-hash", actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      changeAccountPassword(2, "new-hash", actor, 1)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("分公司编码不可变，停用时撤销 own 用户会话", async () => {
    const c = { id: 1, plant: "A", name: "A公司", isActive: true };
    const { updates } = fakeDb([[c], [c]]);
    await expect(
      saveCompany({ ...c, plant: "B" }, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await saveCompany({ ...c, isActive: false }, actor);
    expect(updates.find(w => w.table === companies)?.value.isActive).toBe(
      false
    );
    expect(
      updates.find(w => w.table === users)?.value.sessionVersion
    ).toBeDefined();
  });
  it("保留已有 OAuth 标识大小写及特殊字符，同时拒绝新建 OAuth", async () => {
    const username = "provider|User:123";
    const { updates } = fakeDb([
      [{ ...base, openId: username, authType: "oauth" }],
    ]);
    const parsed = accountInput.parse({
      ...input(),
      username,
      authType: "oauth",
      dataScope: "all",
    });
    expect(parsed.username).toBe(username);
    await saveAccount(parsed, actor);
    expect(updates[0].value).toMatchObject({
      authType: "oauth",
      dataScope: "all",
    });
    await expect(
      saveAccount({ ...parsed, userId: undefined }, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      accountInput.safeParse({ ...parsed, authType: "ldap" }).success
    ).toBe(false);
    expect(
      accountInput.parse({ ...input(), username: " TeStEr " }).username
    ).toBe("tester");
  });
  it("保存本公司权限先锁公司再锁用户", async () => {
    const { updates } = fakeDb([
      [{ id: 1, plant: "A", isActive: true }],
      [base],
    ]);
    await saveAccount({ ...input(), dataScope: "own", companyId: 1 }, actor);
    expect(updates[0].value).toMatchObject({ dataScope: "own", companyId: 1 });
  });
  it("并发新建的唯一键冲突返回明确错误", async () => {
    const { adapter } = fakeDb([[]]);
    adapter.insert.mockImplementation(() => ({
      values: async () => {
        throw { cause: { code: "ER_DUP_ENTRY" } };
      },
    }));
    await expect(
      saveAccount({ ...input(), userId: undefined }, actor)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("密码按 UTF-8 字节长度校验，避免 bcrypt 截断", () => {
    expect(localPasswordInput.safeParse("字".repeat(25)).success).toBe(false);
    expect(localPasswordInput.safeParse("字".repeat(24)).success).toBe(true);
  });
});

describe("零权限原子注册", () => {
  it("并发首次登录仅插入一条账号且固定零权限", async () => {
    let stored: User | undefined;
    const values = vi.fn(async (profile: any) => {
      if (stored) throw { code: "ER_DUP_ENTRY" };
      stored = { ...base, ...profile };
    });
    vi.spyOn(db, "getDb").mockResolvedValue({
      insert: () => ({ values }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (stored ? [stored] : []) }),
        }),
      }),
    } as any);
    const results = await Promise.all([
      registerAdAccount({ openId: "tester", name: "测试" }),
      registerAdAccount({ openId: "tester", name: "测试" }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(stored).toMatchObject({
      role: "user",
      authType: "ldap",
      dataScope: "none",
      companyId: null,
      passwordHash: null,
    });
    expect(values).toHaveBeenCalledTimes(2);
  });
  it("重复注册不覆盖已有授权，同名本地账号不被转换", async () => {
    const { adapter, updates } = fakeDb([
      [{ ...base, dataScope: "all", companyId: 3 }],
      [{ ...base, authType: "local" }],
    ]);
    adapter.insert.mockImplementation(() => ({
      values: async () => {
        throw { cause: { code: "ER_DUP_ENTRY" } };
      },
    }));
    expect((await registerAdAccount({ openId: "tester" })).dataScope).toBe(
      "all"
    );
    await expect(registerAdAccount({ openId: "tester" })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" }
    );
    expect(updates).toEqual([]);
  });
  it("数据库错误不能作为账号已存在吞掉", async () => {
    const { adapter } = fakeDb([]);
    adapter.insert.mockImplementation(() => ({
      values: async () => {
        throw new Error("数据库断开");
      },
    }));
    await expect(registerAdAccount({ openId: "tester" })).rejects.toThrow(
      "数据库断开"
    );
    expect(adapter.select).not.toHaveBeenCalled();
  });
});
