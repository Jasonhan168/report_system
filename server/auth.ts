/**
 * 多模式认证模块
 *
 * AUTH_MODE=local  → 默认本地账号密码登录（测试环境）
 * AUTH_MODE=ldap   → 默认 AD域 LDAP 登录（生产环境）
 * AUTH_MODE=oauth  → Manus OAuth 登录（云端部署）
 *
 * 登录策略（不论 AUTH_MODE）：
 *   1. 先查用户表，若用户存在且有 passwordHash → 本地验证
 *   2. 用户存在但无 passwordHash，或用户不存在 → 走 LDAP 验证
 *   3. AUTH_MODE=local 且 LDAP 未配置时，若用户无密码则提示联系管理员
 */
import bcrypt from "bcryptjs";
import { Client as LdapClient } from "ldapts";
import { ENV } from "./_core/env";
import * as db from "./db";

// ─── 本地账号密码认证 ──────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * 本地账号密码登录（用户必须存在且有 passwordHash）
 */
export async function authenticateLocal(
  username: string,
  password: string
): Promise<Awaited<ReturnType<typeof db.getUserByOpenId>>> {
  const user = await db.getUserByOpenId(username);

  if (!user) {
    throw new Error("用户名或密码错误");
  }
  if (!user.isActive) {
    throw new Error("账号已被禁用，请联系管理员");
  }
  if (!user.passwordHash) {
    throw new Error("该账号未设置密码，请联系管理员");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new Error("用户名或密码错误");
  }

  return user;
}

// ─── AD域 LDAP 认证 ────────────────────────────────────────────────────────────

export interface LdapConfig {
  url: string;
  domain: string;
  baseDn: string;
  bindUser?: string;
  bindPassword?: string;
}

export async function getLdapConfig(): Promise<LdapConfig | null> {
  try {
    const configs = await db.getAllSystemConfigs();
    const get = (key: string) => configs.find((c) => c.key === key)?.value ?? "";

    const url = get("ad_server_url");
    const domain = get("ad_domain");
    const baseDn = get("ad_base_dn");
    const bindUser = get("ad_bind_user");
    const bindPassword = get("ad_bind_password");

    if (!url || !domain || !baseDn) return null;

    return { url, domain, baseDn, bindUser, bindPassword };
  } catch {
    return null;
  }
}

export async function authenticateLdap(
  username: string,
  password: string
): Promise<{ openId: string; name: string; email: string | null; department: string | null }> {
  const config = await getLdapConfig();
  if (!config) {
    throw new Error("AD域配置不完整，请在系统配置中填写 AD服务器地址、域名和Base DN");
  }

  let bindDn: string;
  if (username.includes("@")) {
    bindDn = username;
  } else if (username.includes("\\")) {
    bindDn = username;
  } else {
    const domainShort = config.domain.split(".")[0].toUpperCase();
    bindDn = `${domainShort}\\${username}`;
  }

  const client = new LdapClient({ url: config.url, timeout: 5000, connectTimeout: 5000 });

  try {
    await client.bind(bindDn, password);

    let displayName = username;
    let email: string | null = null;
    let department: string | null = null;

    try {
      const samAccountName = username.includes("\\")
        ? username.split("\\")[1]
        : username.split("@")[0];

      const { searchEntries } = await client.search(config.baseDn, {
        scope: "sub",
        filter: `(sAMAccountName=${samAccountName})`,
        attributes: ["displayName", "mail", "department", "cn"],
      });

      if (searchEntries.length > 0) {
        const entry = searchEntries[0];
        displayName = (entry.displayName as string) || (entry.cn as string) || username;
        email = (entry.mail as string) || null;
        department = (entry.department as string) || null;
      }
    } catch {
      // 搜索失败不影响登录
    }

    const openId = username.includes("\\")
      ? username.split("\\")[1].toLowerCase()
      : username.split("@")[0].toLowerCase();

    return { openId, name: displayName, email, department };
  } finally {
    await client.unbind();
  }
}

// ─── 统一登录入口 ──────────────────────────────────────────────────────────────

export type AuthResult = {
  openId: string;
  name: string;
  email: string | null;
  department: string | null;
  loginMethod: string;
};

/**
 * 统一登录验证
 *
 * 策略（按顺序）：
 *   1. 查用户表，若用户存在且有 passwordHash → 本地密码验证
 *   2. 否则尝试 LDAP 验证（需系统配置中已填写 AD 参数）
 *   3. LDAP 未配置且无本地密码 → 提示联系管理员
 *
 * 这样管理员账号（有 passwordHash）始终可以用本地密码登录，
 * 普通域账号（无 passwordHash）走 LDAP，互不干扰。
 */
export async function authenticate(
  username: string,
  password: string
): Promise<AuthResult> {
  // 先查用户表
  const user = await db.getUserByOpenId(username);

  // 情况1：用户存在且有本地密码 → 本地验证
  if (user && user.passwordHash) {
    if (!user.isActive) {
      throw new Error("账号已被禁用，请联系管理员");
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new Error("用户名或密码错误");
    }
    return {
      openId: user.openId,
      name: user.name || username,
      email: user.email || null,
      department: user.department || null,
      loginMethod: "local",
    };
  }

  // 情况2：用户存在但无本地密码，或用户不存在 → 尝试 LDAP
  const ldapConfig = await getLdapConfig();
  if (ldapConfig) {
    const result = await authenticateLdap(username, password);
    return { ...result, loginMethod: "ldap" };
  }

  // 情况3：无 LDAP 配置，用户也无本地密码
  if (user && !user.passwordHash) {
    throw new Error("该账号未设置密码，请联系管理员");
  }

  throw new Error("用户名或密码错误");
}
