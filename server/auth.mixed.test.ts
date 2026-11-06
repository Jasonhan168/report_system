import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { Client as LdapClient } from "ldapts";
import type { User } from "../drizzle/schema";
import { COOKIE_NAME, SESSION_IDLE_TIMEOUT_MS } from "../shared/const";
import {
  authenticate,
  authenticateLdap,
  normalizeUsername,
  escapeLdapFilter,
  hashPassword,
} from "./auth";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import * as db from "./db";
import * as accounts from "./accounts";

const ldap = vi.hoisted(() => ({
  bind: vi.fn(),
  search: vi.fn(),
  unbind: vi.fn(),
}));
vi.mock("ldapts", () => ({
  Client: vi.fn(function () {
    return ldap;
  }),
}));
const base: User = {
  id: 1,
  openId: "tester",
  name: "测试",
  email: null,
  department: null,
  loginMethod: "local",
  authType: "local",
  role: "user",
  companyId: null,
  dataScope: "none",
  sessionVersion: 3,
  passwordHash: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const configs = [
  { key: "ad_server_url", value: "ldaps://dc.example.com:636" },
  { key: "ad_domain", value: "example.com" },
  { key: "ad_netbios_domain", value: "EXAMPLE" },
  { key: "ad_base_dn", value: "DC=example,DC=com" },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(LdapClient).mockClear();
  vi.spyOn(accounts, "requireDb").mockResolvedValue({} as any);
  vi.spyOn(db, "getUserByOpenId").mockResolvedValue({ ...base });
  vi.spyOn(db, "getAllSystemConfigs").mockResolvedValue(configs as any);
  vi.spyOn(db, "getSystemConfigByKey").mockResolvedValue({
    value: "false",
  } as any);
  vi.spyOn(db, "upsertUser").mockResolvedValue();
  vi.spyOn(accounts, "registerAdAccount").mockResolvedValue({
    ...base,
    authType: "ldap",
  });
  ldap.bind.mockReset().mockResolvedValue(undefined);
  ldap.unbind.mockReset().mockResolvedValue(undefined);
  ldap.search.mockReset().mockResolvedValue({
    searchEntries: [{ sAMAccountName: "tester", displayName: "测试" }],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("显式混合认证", () => {
  it("本地正确/错误密码都不尝试 AD", async () => {
    vi.mocked(db.getUserByOpenId).mockResolvedValue({
      ...base,
      passwordHash: await hashPassword("correct"),
    });
    expect((await authenticate("TESTER", "correct")).loginMethod).toBe("local");
    await expect(authenticate("tester", "wrong")).rejects.toThrow(
      "用户名或密码错误"
    );
    expect(ldap.bind).not.toHaveBeenCalled();
  });
  it("AD 账号残留本地密码也不回退", async () => {
    vi.mocked(db.getUserByOpenId).mockResolvedValue({
      ...base,
      authType: "ldap",
      passwordHash: await hashPassword("local-old"),
    });
    ldap.bind.mockRejectedValue({ code: 49 });
    await expect(authenticate("tester", "local-old")).rejects.toThrow(
      "用户名或密码错误"
    );
    expect(accounts.registerAdAccount).not.toHaveBeenCalled();
  });
  it("AD 故障明确失败且不自动注册", async () => {
    vi.mocked(db.getUserByOpenId).mockResolvedValue({
      ...base,
      authType: "ldap",
    });
    ldap.bind.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(authenticate("tester", "password")).rejects.toThrow(
      "AD认证失败"
    );
    expect(accounts.registerAdAccount).not.toHaveBeenCalled();
  });
  it.each(["local", "ldap"] as const)(
    "禁用 %s 账号不能登录",
    async authType => {
      vi.mocked(db.getUserByOpenId).mockResolvedValue({
        ...base,
        authType,
        isActive: false,
      });
      await expect(authenticate("tester", "password")).rejects.toThrow("禁用");
      expect(ldap.bind).not.toHaveBeenCalled();
    }
  );
  it("自动注册关闭/读取失败均拒绝新账号", async () => {
    vi.mocked(db.getUserByOpenId).mockResolvedValue(undefined);
    await expect(authenticate("tester", "password")).rejects.toThrow("未登记");
    vi.mocked(db.getSystemConfigByKey).mockRejectedValue(
      new Error("数据库故障")
    );
    await expect(authenticate("tester", "password")).rejects.toThrow();
    expect(ldap.bind).not.toHaveBeenCalled();
    expect(accounts.registerAdAccount).not.toHaveBeenCalled();
  });
  it("开启后验证 AD 才注册，已有账号不重新注册", async () => {
    vi.mocked(db.getUserByOpenId).mockResolvedValue(undefined);
    vi.mocked(db.getSystemConfigByKey).mockResolvedValue({
      value: "true",
    } as any);
    expect((await authenticate("EXAMPLE\\Tester", "password")).openId).toBe(
      "tester"
    );
    expect(accounts.registerAdAccount).toHaveBeenCalledTimes(1);
    expect(ldap.bind).toHaveBeenCalledWith("tester@example.com", "password");
    vi.mocked(db.getUserByOpenId).mockResolvedValue({
      ...base,
      authType: "ldap",
      dataScope: "all",
    });
    await authenticate("tester@example.com", "password");
    expect(accounts.registerAdAccount).toHaveBeenCalledTimes(1);
  });
  it("认证数据库不可用时不查询 AD 或建档", async () => {
    vi.mocked(accounts.requireDb).mockRejectedValue(
      new Error("用户数据库不可用")
    );
    await expect(authenticate("tester", "password")).rejects.toThrow(
      "数据库不可用"
    );
    expect(ldap.bind).not.toHaveBeenCalled();
    expect(accounts.registerAdAccount).not.toHaveBeenCalled();
  });
  it("拒绝错误域和返回身份不一致", async () => {
    expect(normalizeUsername("EXAMPLE\\Tester", "example.com")).toBe("tester");
    expect(normalizeUsername("tester@EXAMPLE.COM", "example.com")).toBe(
      "tester"
    );
    expect(() => normalizeUsername("evil\\tester", "example.com")).toThrow();
    expect(() => normalizeUsername("tester@evil.com", "example.com")).toThrow();
    ldap.search.mockResolvedValue({
      searchEntries: [{ sAMAccountName: "another-user" }],
    });
    await expect(authenticateLdap("tester", "password")).rejects.toThrow(
      "身份无法确认"
    );
  });
  it("LDAP 特殊字符转义", () => {
    expect(escapeLdapFilter("a*(b)\\\0")).toBe("a\\2a\\28b\\29\\5c\\00");
  });
  it.each([
    [true, "ldap://dc.example.com:389"],
    [true, "ldaps://dc.example.com:636"],
    [false, "ldap://dc.example.com:389"],
    [false, "ldaps://dc.example.com:636"],
  ] as const)(
    "生产模式=%s，按配置的 %s 完成域认证",
    async (production, url) => {
      const previous = ENV.isProduction;
      ENV.isProduction = production;
      try {
        vi.mocked(db.getAllSystemConfigs).mockResolvedValue(
          configs.map(c =>
            c.key === "ad_server_url" ? { ...c, value: url } : c
          ) as any
        );
        vi.mocked(db.getUserByOpenId).mockResolvedValue({
          ...base,
          authType: "ldap",
        });
        await expect(
          authenticate("EXAMPLE\\Tester", "password")
        ).resolves.toMatchObject({
          openId: "tester",
          loginMethod: "ldap",
          sessionVersion: base.sessionVersion,
        });
        expect(LdapClient).toHaveBeenCalledTimes(1);
        expect(LdapClient).toHaveBeenCalledWith({
          url,
          timeout: 5000,
          connectTimeout: 5000,
        });
        expect(ldap.bind).toHaveBeenCalledWith(
          "tester@example.com",
          "password"
        );
        expect(ldap.search).toHaveBeenCalledWith(
          "DC=example,DC=com",
          expect.objectContaining({
            filter: "(sAMAccountName=tester)",
            attributes: ["sAMAccountName"],
          })
        );
        expect(accounts.registerAdAccount).not.toHaveBeenCalled();
      } finally {
        ENV.isProduction = previous;
      }
    }
  );
  it("LDAPS 证书错误仍拒绝认证，不自动重试明文 LDAP", async () => {
    const error = Object.assign(new Error("无法验证服务器证书"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    ldap.bind.mockRejectedValue(error);
    await expect(authenticateLdap("tester", "password")).rejects.toBe(error);
    expect(LdapClient).toHaveBeenCalledTimes(1);
    expect(LdapClient).toHaveBeenCalledWith({
      url: "ldaps://dc.example.com:636",
      timeout: 5000,
      connectTimeout: 5000,
    });
    expect(ldap.search).not.toHaveBeenCalled();
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });
  it("DTO 不包含密码及会话内部版本", () => {
    const dto = accounts.safeUser({ ...base, passwordHash: "not-exposed" });
    expect(dto).not.toHaveProperty("passwordHash");
    expect(dto).not.toHaveProperty("sessionVersion");
  });
});

describe("版本化会话", () => {
  it("版本不匹配、停用、无版本旧 JWT 均无效", async () => {
    const token = await sdk.createSessionToken(base.openId, {
      sessionVersion: 2,
    });
    await expect(
      sdk.authenticateLocalRequest({
        headers: { cookie: `${COOKIE_NAME}=${token}` },
      } as any)
    ).rejects.toThrow("撤销");
    const current = await sdk.createSessionToken(base.openId, {
      sessionVersion: 3,
    });
    vi.mocked(db.getUserByOpenId).mockResolvedValue({
      ...base,
      isActive: false,
    });
    await expect(
      sdk.authenticateLocalRequest({
        headers: { cookie: `${COOKIE_NAME}=${current}` },
      } as any)
    ).rejects.toThrow("停用");
    const legacy = await new SignJWT({ openId: base.openId })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(ENV.cookieSecret));
    expect(await sdk.verifySession(legacy)).toBeNull();
  });
  it("8小时会话正常验证，短期会话续期保持版本", async () => {
    const token = await sdk.createSessionToken(base.openId, {
      sessionVersion: 3,
      expiresInMs: 3600_000,
    });
    const req = {
      protocol: "https",
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    } as any;
    const cookie = vi.fn();
    expect(
      (await sdk.authenticateLocalRequest(req, { cookie } as any)).id
    ).toBe(base.id);
    expect(cookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ maxAge: SESSION_IDLE_TIMEOUT_MS })
    );
    expect(
      (await sdk.verifySession(cookie.mock.calls[0][1]))?.sessionVersion
    ).toBe(3);
  });
});
