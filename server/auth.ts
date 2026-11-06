/**
 * 多模式认证模块
 *
 * AUTH_MODE=local  → 默认本地账号密码登录（测试环境）
 * AUTH_MODE=ldap   → 默认 AD域 LDAP 登录（生产环境）
 * AUTH_MODE=oauth  → Manus OAuth 登录（云端部署）
 *
 * local / ldap / hybrid 共用表单，按 users.authType 严格选择认证方式。
 * AD 不降级为本地验证；未登记账号仅在自动注册开启时验证 AD 并注册零权限账号。
 */
import bcrypt from "bcryptjs";
import { Client as LdapClient } from "ldapts";
import * as db from "./db";
import { registerAdAccount, requireDb } from "./accounts";

export function normalizeUsername(username: string, domain?: string, netbios?: string): string {
  const value = username.trim().toLowerCase();
  let account = value;
  if (value.includes("\\")) {
    const parts = value.split("\\");
    if (parts.length !== 2 || !domain || parts[0] !== (netbios || domain.split(".")[0]).toLowerCase()) throw new Error("不支持的AD域");
    account = parts[1];
  } else if (value.includes("@")) {
    const parts = value.split("@");
    if (parts.length !== 2 || !domain || parts[1] !== domain.toLowerCase()) throw new Error("不支持的AD域");
    account = parts[0];
  }
  if (!/^[a-z0-9_.-]{1,64}$/.test(account)) throw new Error("用户名格式不正确");
  return account;
}

export function escapeLdapFilter(value: string) {
  return value.replace(/[\\*()\u0000]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

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
  const user = await db.getUserByOpenId(normalizeUsername(username));

  if (user && user.authType !== "local") throw new Error("该账号不支持本地密码认证");
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
  netbios?: string;
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

    return { url, domain, baseDn, bindUser, bindPassword, netbios: get("ad_netbios_domain") };
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

  const account = normalizeUsername(username, config.domain, config.netbios);
  if (!password) throw new Error("密码不能为空");
  // 按已配置的 LDAP / LDAPS 协议连接，不因生产模式强制切换。
  const bindDn = `${account}@${config.domain}`;

  const client = new LdapClient({ url: config.url, timeout: 5000, connectTimeout: 5000 });

  try {
    await client.bind(bindDn, password);

    const identity = await client.search(config.baseDn, {
      scope: "sub", filter: `(sAMAccountName=${escapeLdapFilter(account)})`,
      attributes: ["sAMAccountName"],
    });
    if (identity.searchEntries.length !== 1 || String(identity.searchEntries[0].sAMAccountName).toLowerCase() !== account) throw new Error("AD账号身份无法确认");
    let displayName = account;
    let email: string | null = null;
    let department: string | null = null;

    try {
      const samAccountName = username.includes("\\")
        ? username.split("\\")[1]
        : username.split("@")[0];

      const { searchEntries } = await client.search(config.baseDn, {
        scope: "sub",
        filter: `(sAMAccountName=${escapeLdapFilter(samAccountName)})`,
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

    const openId = account;

    return { openId, name: displayName, email, department };
  } finally {
    await client.unbind().catch(() => {});
  }
}

// ─── 统一登录入口 ──────────────────────────────────────────────────────────────

export type AuthResult = {
  openId: string;
  name: string;
  email: string | null;
  department: string | null;
  loginMethod: string;
  sessionVersion: number;
};

/**
 * 统一登录验证
 *
 * 已有用户严格按 authType 验证；本地失败不尝试 AD，AD 失败不回退本地。
 * 新 AD 账号需开启自动注册，并由注册函数固定为零业务权限。
 */
export async function authenticate(
  username: string,
  password: string
): Promise<AuthResult> {
  await requireDb();
  const qualified = username.includes("\\") || username.includes("@");
  const config = qualified ? await getLdapConfig() : null;
  const account = normalizeUsername(username, config?.domain, config?.netbios);
  // 先查用户表
  let user = await db.getUserByOpenId(account);
  if (user && !user.isActive) throw new Error("账号已被禁用，请联系管理员");
  if (user?.authType === "oauth") throw new Error("该账号仅支持OAuth认证");
  if (qualified && user?.authType === "local") throw new Error("本地账号请使用短用户名登录");

  // 情况1：用户存在且有本地密码 → 本地验证
  if (user?.authType === "local") {
    if (!user.passwordHash) throw new Error("该账号未设置密码，请联系管理员");
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
      sessionVersion: user.sessionVersion,
    };
  }

  // 情况2：用户存在但无本地密码，或用户不存在 → 尝试 LDAP
  if (!user) {
    const autoRegister = await db.getSystemConfigByKey("ad_auto_register");
    if (autoRegister?.value !== "true") throw new Error("账号未登记，请联系管理员");
  } else if (user.authType !== "ldap") {
    throw new Error("账号认证方式未配置");
  }
  const ldapConfig = await getLdapConfig();
  if (ldapConfig) {
    let result;
    try { result = await authenticateLdap(account, password); }
    catch (error: any) {
      if (error?.code === 49 || error?.name === "InvalidCredentialsError") throw new Error("用户名或密码错误");
      throw new Error("AD认证失败，请检查域服务及安全连接配置");
    }
    if (result.openId !== account) throw new Error("AD身份与登录账号不一致");
    if (!user) user = await registerAdAccount(result);
    return { ...result, openId: user.openId, loginMethod: "ldap", sessionVersion: user.sessionVersion };
  }

  throw new Error("AD域配置不完整，请联系管理员配置认证服务");
}
