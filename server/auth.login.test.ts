import { describe, expect, it, vi, beforeEach } from "vitest";
import { hashPassword, verifyPassword, authenticateLocal } from "./auth";
import * as db from "./db";

// ─── 密码哈希测试 ──────────────────────────────────────────────────────────────
describe("hashPassword / verifyPassword", () => {
  it("应对密码进行哈希并能验证", async () => {
    const password = "TestPassword123";
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true); // bcrypt 格式
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it("错误密码验证应返回 false", async () => {
    const hash = await hashPassword("correct-password");
    const valid = await verifyPassword("wrong-password", hash);
    expect(valid).toBe(false);
  });

  it("不同密码应生成不同哈希", async () => {
    const hash1 = await hashPassword("password1");
    const hash2 = await hashPassword("password2");
    expect(hash1).not.toBe(hash2);
  });

  it("相同密码多次哈希应生成不同哈希（bcrypt加盐）", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
    // 但两者都应能验证原密码
    expect(await verifyPassword("same-password", hash1)).toBe(true);
    expect(await verifyPassword("same-password", hash2)).toBe(true);
  });
});

// ─── 本地认证测试 ──────────────────────────────────────────────────────────────
describe("authenticateLocal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("正确用户名密码应认证成功", async () => {
    const hash = await hashPassword("correct-pass");
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue({
      id: 1,
      openId: "testuser",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "local",
      role: "user",
      department: null,
      isActive: true,
      passwordHash: hash,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const user = await authenticateLocal("testuser", "correct-pass");
    expect(user).not.toBeNull();
    expect(user?.openId).toBe("testuser");
  });

  it("用户不存在应抛出错误", async () => {
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue(undefined);
    await expect(authenticateLocal("nouser", "pass")).rejects.toThrow("用户名或密码错误");
  });

  it("密码错误应抛出错误", async () => {
    const hash = await hashPassword("correct-pass");
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue({
      id: 1,
      openId: "testuser",
      name: "Test User",
      email: null,
      loginMethod: "local",
      role: "user",
      department: null,
      isActive: true,
      passwordHash: hash,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    await expect(authenticateLocal("testuser", "wrong-pass")).rejects.toThrow("用户名或密码错误");
  });

  it("账号被禁用应抛出错误", async () => {
    const hash = await hashPassword("pass");
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue({
      id: 1,
      openId: "disabled-user",
      name: "Disabled",
      email: null,
      loginMethod: "local",
      role: "user",
      department: null,
      isActive: false, // 已禁用
      passwordHash: hash,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    await expect(authenticateLocal("disabled-user", "pass")).rejects.toThrow("账号已被禁用");
  });

  it("账号未设置密码应抛出错误", async () => {
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue({
      id: 1,
      openId: "no-pass-user",
      name: "No Pass",
      email: null,
      loginMethod: "ldap",
      role: "user",
      department: null,
      isActive: true,
      passwordHash: null, // 未设置密码
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    await expect(authenticateLocal("no-pass-user", "any")).rejects.toThrow("该账号未设置密码");
  });
});
