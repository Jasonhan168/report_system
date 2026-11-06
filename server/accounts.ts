import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  companies,
  users,
  operationLogs,
  reportPermissions,
  systemConfigs,
  type User,
  type InsertUser,
} from "../drizzle/schema";
import { getDb } from "./db";

export async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "用户数据库不可用",
    });
  return db;
}

export function safeUser(user: User) {
  const { passwordHash: _password, sessionVersion: _version, ...safe } = user;
  return safe;
}

export async function saveReportPermission(
  data: {
    userId: number;
    reportModuleId: number;
    canView: boolean;
    canExport: boolean;
  },
  actor: User
) {
  const db = await requireDb();
  await db.transaction(async tx => {
    const user = (
      await tx
        .select()
        .from(users)
        .where(eq(users.id, data.userId))
        .for("update")
    )[0];
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
    const condition = and(
      eq(reportPermissions.userId, data.userId),
      eq(reportPermissions.reportModuleId, data.reportModuleId)
    );
    const before = await tx.select().from(reportPermissions).where(condition);
    await tx.delete(reportPermissions).where(condition);
    await tx.insert(reportPermissions).values(data);
    await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));
    await tx
      .insert(operationLogs)
      .values({
        userId: actor.id,
        userOpenId: actor.openId,
        userName: actor.name,
        action: "security_change",
        resourceType: "security",
        resourceCode: "report_permission",
        params: { before, after: data },
      });
  });
}

export async function saveSystemConfigs(
  items: {
    key: string;
    value: string;
    description?: string;
    category?: string;
  }[],
  actor: User
) {
  const db = await requireDb();
  await db.transaction(async tx => {
    for (const item of items) {
      if (
        item.key === "ad_auto_register" &&
        !["true", "false"].includes(item.value)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "自动注册配置必须为布尔值",
        });
      const before = (
        await tx
          .select()
          .from(systemConfigs)
          .where(eq(systemConfigs.key, item.key))
      )[0];
      await tx
        .insert(systemConfigs)
        .values(item)
        .onDuplicateKeyUpdate({ set: { value: item.value } });
      if (before?.value !== item.value) {
        const secret = /password|secret|token|key$/i.test(item.key);
        await tx
          .insert(operationLogs)
          .values({
            userId: actor.id,
            userOpenId: actor.openId,
            userName: actor.name,
            action: "security_change",
            resourceType: "security",
            resourceCode: "system_config",
            params: {
              key: item.key,
              before: secret ? "[已隐藏]" : before?.value,
              after: secret ? "[已隐藏]" : item.value,
            },
          });
      }
    }
  });
}

export async function getCompany(id: number) {
  const db = await requireDb();
  return (
    await db.select().from(companies).where(eq(companies.id, id)).limit(1)
  )[0];
}

export async function listCompanies() {
  return (await requireDb()).select().from(companies).orderBy(companies.plant);
}

export const localPasswordInput = z
  .string()
  .min(6, "密码至少6位")
  .refine(
    value => Buffer.byteLength(value, "utf8") <= 72,
    "密码不能超过72字节"
  );

export const accountInput = z
  .object({
    userId: z.number().int().positive().optional(),
    username: z.string().trim().min(1).max(64),
    displayName: z.string().trim().min(1).max(128),
    email: z.string().email().or(z.literal("")).optional(),
    department: z.string().max(128).optional(),
    role: z.enum(["user", "admin"]).default("user"),
    authType: z.enum(["local", "ldap", "oauth"]),
    companyId: z.number().int().positive().nullable(),
    dataScope: z.enum(["none", "own", "all"]),
    password: localPasswordInput.optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.authType !== "oauth" &&
      !/^[a-zA-Z0-9_.-]+$/.test(input.username)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["username"],
        message: "本地和 AD 账号只能包含字母、数字、下划线、点和连字符",
      });
    }
  })
  .transform(input => ({
    ...input,
    username:
      input.authType === "oauth"
        ? input.username
        : input.username.toLowerCase(),
  }));

function securityValues(user: User) {
  return {
    role: user.role,
    isActive: user.isActive,
    authType: user.authType,
    companyId: user.companyId,
    dataScope: user.dataScope,
  };
}

export async function saveAccount(
  input: z.infer<typeof accountInput>,
  actor: User,
  passwordHash?: string
) {
  input = accountInput.parse(input);
  if (input.role === "admin" && input.dataScope !== "all")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "系统管理员必须拥有全部数据范围",
    });
  if (actor.id === input.userId && input.role !== "admin")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "不能取消自己的管理员身份",
    });
  if (input.dataScope === "own" && !input.companyId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "本公司范围必须选择所属分公司",
    });
  const db = await requireDb();
  return db.transaction(async tx => {
    // 与分公司停用保持相同的锁顺序：先公司、后用户。
    if (input.companyId) {
      const company = (
        await tx
          .select()
          .from(companies)
          .where(eq(companies.id, input.companyId))
          .for("update")
      )[0];
      if (!company?.isActive)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "分公司不存在或已停用",
        });
    }
    const before = input.userId
      ? (
          await tx
            .select()
            .from(users)
            .where(eq(users.id, input.userId))
            .for("update")
        )[0]
      : undefined;
    if (input.userId && !before)
      throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
    const previousUsername =
      input.authType === "oauth"
        ? before?.openId
        : before?.openId.toLowerCase();
    if (before && previousUsername !== input.username)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "不支持修改登录账号",
      });
    if (input.authType === "oauth" && before?.authType !== "oauth")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "本期不支持新建或切换到OAuth账号",
      });
    if (
      input.authType === "local" &&
      (!before || before.authType !== "local") &&
      !passwordHash
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "本地账号必须设置密码",
      });
    if (passwordHash && input.authType !== "local")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "仅本地账号可以设置密码",
      });
    const values = {
      name: input.displayName,
      email: input.email || null,
      department: input.department || null,
      role: input.role,
      authType: input.authType,
      companyId: input.companyId,
      dataScope: input.dataScope,
      ...(input.authType !== "local"
        ? { passwordHash: null }
        : passwordHash
          ? { passwordHash }
          : {}),
    };
    if (before) {
      await tx
        .update(users)
        .set({ ...values, sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, before.id));
    } else {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.openId, input.username));
      if (existing.length)
        throw new TRPCError({ code: "CONFLICT", message: "用户名已存在" });
      try {
        await tx.insert(users).values({ openId: input.username, ...values });
      } catch (error: any) {
        if (
          error?.code === "ER_DUP_ENTRY" ||
          error?.cause?.code === "ER_DUP_ENTRY"
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "用户名已存在" });
        }
        throw error;
      }
    }
    await tx.insert(operationLogs).values({
      userId: actor.id,
      userOpenId: actor.openId,
      userName: actor.name,
      action: "security_change",
      resourceType: "security",
      resourceCode: "user_access",
      params: {
        account: input.username,
        before: before ? securityValues(before) : null,
        after: {
          role: values.role,
          authType: values.authType,
          companyId: values.companyId,
          dataScope: values.dataScope,
        },
        passwordChanged: Boolean(passwordHash),
      },
    });
    return { success: true };
  });
}

export async function setAccountActive(
  userId: number,
  active: boolean,
  actor: User
) {
  if (actor.id === userId && !active)
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能停用自己的账号" });
  const db = await requireDb();
  await db.transaction(async tx => {
    const before = (
      await tx.select().from(users).where(eq(users.id, userId)).for("update")
    )[0];
    if (!before)
      throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
    await tx
      .update(users)
      .set({
        isActive: active,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, userId));
    await tx
      .insert(operationLogs)
      .values({
        userId: actor.id,
        userOpenId: actor.openId,
        userName: actor.name,
        action: "security_change",
        resourceType: "security",
        resourceCode: "user_active",
        params: { userId, before: before.isActive, after: active },
      });
  });
}

export async function changeAccountPassword(
  userId: number,
  hash: string,
  actor: User,
  expectedVersion?: number
) {
  const db = await requireDb();
  await db.transaction(async tx => {
    const user = (
      await tx.select().from(users).where(eq(users.id, userId)).for("update")
    )[0];
    if (!user || user.authType !== "local")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "仅本地账号支持修改密码",
      });
    if (
      expectedVersion !== undefined &&
      user.sessionVersion !== expectedVersion
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "账号已变更，请重新登录",
      });
    await tx
      .update(users)
      .set({
        passwordHash: hash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, userId));
    await tx
      .insert(operationLogs)
      .values({
        userId: actor.id,
        userOpenId: actor.openId,
        userName: actor.name,
        action: "security_change",
        resourceType: "security",
        resourceCode: "password",
        params: { targetUserId: userId },
      });
  });
}

// 只插入，不以首次登录资料覆盖已存在账号的权限或认证方式。
export async function registerAdAccount(
  profile: Pick<InsertUser, "openId" | "name" | "email" | "department">,
  authType: "ldap" | "oauth" = "ldap"
) {
  const db = await requireDb();
  try {
    await db
      .insert(users)
      .values({
        ...profile,
        role: "user",
        authType,
        loginMethod: authType,
        companyId: null,
        dataScope: "none",
        passwordHash: null,
      });
  } catch (error: any) {
    if (error?.code !== "ER_DUP_ENTRY" && error?.cause?.code !== "ER_DUP_ENTRY")
      throw error;
  }
  const user = (
    await db
      .select()
      .from(users)
      .where(eq(users.openId, profile.openId))
      .limit(1)
  )[0];
  if (!user?.isActive || user.authType !== authType)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "账号不可用或认证方式不匹配",
    });
  return user;
}

export async function saveCompany(
  input: { id?: number; plant: string; name: string; isActive: boolean },
  actor: User
) {
  const db = await requireDb();
  await db.transaction(async tx => {
    const before = input.id
      ? (
          await tx
            .select()
            .from(companies)
            .where(eq(companies.id, input.id))
            .for("update")
        )[0]
      : undefined;
    if (input.id && !before)
      throw new TRPCError({ code: "NOT_FOUND", message: "分公司不存在" });
    if (before && before.plant !== input.plant)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "分公司编码不可修改",
      });
    if (before) {
      await tx
        .update(companies)
        .set({ name: input.name, isActive: input.isActive })
        .where(eq(companies.id, before.id));
      if (before.isActive !== input.isActive)
        await tx
          .update(users)
          .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
          .where(
            and(eq(users.companyId, before.id), eq(users.dataScope, "own"))
          );
    } else {
      await tx
        .insert(companies)
        .values({
          plant: input.plant,
          name: input.name,
          isActive: input.isActive,
        });
    }
    await tx
      .insert(operationLogs)
      .values({
        userId: actor.id,
        userOpenId: actor.openId,
        userName: actor.name,
        action: "security_change",
        resourceType: "security",
        resourceCode: "company",
        params: { before, after: input },
      });
  });
  return { success: true };
}
