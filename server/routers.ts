import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getAllUsers, updateUserRole, updateUserActive, getUserByOpenId, upsertUser,
  getAllDatasources, getDatasourceById, createDatasource, updateDatasource, deleteDatasource,
  getAllReportModules, getReportModuleByCode, createReportModule, updateReportModule,
  getPermissionsByUserId, getPermissionsByReportId, upsertReportPermission,
  getAllPermissionsWithUsers, getAllSystemConfigs, upsertSystemConfig,
  initDefaultData, listOperationLogs,
} from "./db";
import { testClickHouseConnection, invalidateClickHouseClient } from "./datasource";
import { makeReportRouter } from "./reports/_makeRouter";
import {
  pkgWipSummary,
  outsourceOrderDetail,
  pkgWipDetail,
  pkgWipInprocDetail,
  pkgWipInprocSummary,
  engPkgWip,
  ALL_REPORTS,
} from "./reports/_registry";
import { authenticate, hashPassword, verifyPassword } from "./auth";
import { logOperation } from "./_core/operationLog";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

// ─── 管理员鉴权中间件 ──────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,

  // ─── 认证 ──────────────────────────────────────────────────────────────────
  auth: router({
    // 获取当前登录用户信息
    me: publicProcedure.query(async (opts) => {
      if (opts.ctx.user) {
        await initDefaultData().catch(() => {});
      }
      return opts.ctx.user;
    }),

    // 获取当前认证模式（前端用于决定是否显示本地登录表单）
    authMode: publicProcedure.query(() => {
      return { mode: ENV.authMode };
    }),

    // 登录（local/ldap 模式）
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1, "用户名不能为空"),
        password: z.string().min(1, "密码不能为空"),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ENV.authMode === "oauth") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "当前系统使用OAuth登录" });
        }

        const start = Date.now();
        let authResult;
        try {
          authResult = await authenticate(input.username, input.password);
        } catch (err: any) {
          // 记录登录失败日志
          logOperation({
            user: { openId: input.username, name: input.username },
            action: "login_failed",
            resourceType: "auth",
            params: { username: input.username },
            req: ctx.req,
            success: false,
            errorMsg: err?.message || "登录失败",
            durationMs: Date.now() - start,
          }).catch(() => {});
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message || "登录失败" });
        }

        // 同步用户到数据库
        await upsertUser({
          openId: authResult.openId,
          name: authResult.name,
          email: authResult.email,
          department: authResult.department,
          loginMethod: authResult.loginMethod,
          lastSignedIn: new Date(),
        });

        // 确保初始化默认数据
        await initDefaultData().catch(() => {});

        // 创建 JWT session
        const sessionToken = await sdk.createSessionToken(authResult.openId, {
          name: authResult.name,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        const user = await getUserByOpenId(authResult.openId);

        // 记录登录成功日志
        logOperation({
          user: user ? { id: user.id, openId: user.openId, name: user.name } : null,
          action: "login",
          resourceType: "auth",
          params: { loginMethod: authResult.loginMethod },
          req: ctx.req,
          durationMs: Date.now() - start,
        }).catch(() => {});

        return { success: true, user };
      }),

    // 退出登录
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      // 记录登出日志（即使未登录也尝试记录，帮助排查异常）
      const u = ctx.user;
      logOperation({
        user: u ? { id: u.id, openId: u.openId, name: u.name } : null,
        action: "logout",
        resourceType: "auth",
        req: ctx.req,
      }).catch(() => {});
      return { success: true } as const;
    }),

    // 修改密码（仅 local 模式）
    changePassword: protectedProcedure
      .input(z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6, "新密码至少6位"),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ENV.authMode !== "local") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "当前模式不支持修改密码" });
        }
        const user = ctx.user;
        if (!user.passwordHash) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该账号未设置密码" });
        }
        const valid = await verifyPassword(input.oldPassword, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "原密码错误" });
        }
        const newHash = await hashPassword(input.newPassword);
        await upsertUser({ openId: user.openId, passwordHash: newHash });
        return { success: true };
      }),
  }),

  // ─── 用户管理 ───────────────────────────────────────────────────────────────
  users: router({
    list: adminProcedure.query(async () => getAllUsers()),
    setRole: adminProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ input }) => {
        await updateUserRole(input.userId, input.role);
        return { success: true };
      }),
    setActive: adminProcedure
      .input(z.object({ userId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await updateUserActive(input.userId, input.isActive);
        return { success: true };
      }),
    // 管理员创建本地用户（仅 local 模式）
    create: adminProcedure
      .input(z.object({
        username: z.string().min(1, "用户名不能为空").regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含字母、数字、下划线、点和连字符"),
        displayName: z.string().min(1, "显示名不能为空"),
        password: z.string().min(6, "密码至少6位"),
        email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
        role: z.enum(["user", "admin"]).default("user"),
        department: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        if (ENV.authMode !== "local") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "仅本地模式支持创建用户" });
        }
        const existing = await getUserByOpenId(input.username);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "用户名已存在" });
        }
        const passwordHash = await hashPassword(input.password);
        await upsertUser({
          openId: input.username,
          name: input.displayName,
          email: input.email || null,
          department: input.department || null,
          loginMethod: "local",
          role: input.role,
          passwordHash,
          lastSignedIn: new Date(),
        });
        return { success: true };
      }),
    // 管理员重置用户密码（仅 local 模式）
    resetPassword: adminProcedure
      .input(z.object({
        userId: z.number(),
        newPassword: z.string().min(6, "密码至少6位"),
      }))
      .mutation(async ({ input }) => {
        if (ENV.authMode !== "local") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "仅本地模式支持重置密码" });
        }
        const allUsers = await getAllUsers();
        const user = allUsers.find((u) => u.id === input.userId);
        if (!user) {
          throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        }
        const passwordHash = await hashPassword(input.newPassword);
        await upsertUser({ openId: user.openId, passwordHash });
        return { success: true };
      }),
  }),

  // ─── 数据源管理 ─────────────────────────────────────────────────────────────
  datasources: router({
    list: adminProcedure.query(async () => getAllDatasources()),
    get: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const ds = await getDatasourceById(input.id);
        if (!ds) throw new TRPCError({ code: "NOT_FOUND", message: "数据源不存在" });
        return ds;
      }),
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        type: z.enum(["mysql", "clickhouse", "oracle", "mock"]),
        host: z.string().optional(),
        port: z.number().optional(),
        database: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        await createDatasource(input);
        return { success: true };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        type: z.enum(["mysql", "clickhouse", "oracle", "mock"]).optional(),
        host: z.string().optional(),
        port: z.number().optional(),
        database: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        isDefault: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateDatasource(id, data);
        return { success: true };
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteDatasource(input.id);
        return { success: true };
      }),
    testConnection: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const ds = await getDatasourceById(input.id);
        if (!ds) throw new TRPCError({ code: "NOT_FOUND" });
        if (ds.type === "mock") return { success: true, message: "Mock数据源连接成功" };
        if (ds.type === "clickhouse") {
          const result = await testClickHouseConnection(ds);
          if (!result.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.message });
          return { success: true, message: result.message };
        }
        return { success: true, message: "连接测试成功" };
      }),
    // 更新数据源时清除连接缓存
    invalidateCache: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        invalidateClickHouseClient(input.id);
        return { success: true };
      }),
  }),

  // ─── 报表模块 ───────────────────────────────────────────────────────────────
  reportModules: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const modules = await getAllReportModules();
      if (ctx.user.role === "admin") return modules;
      const permissions = await getPermissionsByUserId(ctx.user.id);
      const allowedIds = new Set(permissions.filter((p) => p.canView).map((p) => p.reportModuleId));
      return modules.filter((m) => allowedIds.has(m.id));
    }),
    listAll: adminProcedure.query(async () => getAllReportModules()),
    create: adminProcedure
      .input(z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        category: z.string().optional(),
        description: z.string().optional(),
        route: z.string().optional(),
        datasourceId: z.number().optional(),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        await createReportModule(input);
        return { success: true };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        category: z.string().optional(),
        description: z.string().optional(),
        route: z.string().optional(),
        datasourceId: z.number().nullable().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateReportModule(id, data);
        return { success: true };
      }),
  }),

  // ─── 报表权限管理 ───────────────────────────────────────────────────────────
  permissions: router({
    listByReport: adminProcedure
      .input(z.object({ reportModuleId: z.number() }))
      .query(async ({ input }) => getPermissionsByReportId(input.reportModuleId)),
    listByUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ input }) => getPermissionsByUserId(input.userId)),
    listAll: adminProcedure.query(async () => getAllPermissionsWithUsers()),
    upsert: adminProcedure
      .input(z.object({
        userId: z.number(),
        reportModuleId: z.number(),
        canView: z.boolean(),
        canExport: z.boolean(),
      }))
      .mutation(async ({ input }) => {
        await upsertReportPermission(input);
        return { success: true };
      }),
    myPermissions: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "admin") {
        const modules = await getAllReportModules();
        return modules.map((m) => ({ reportModuleId: m.id, canView: true, canExport: true }));
      }
      return getPermissionsByUserId(ctx.user.id);
    }),
  }),

  // ─── 系统配置 ───────────────────────────────────────────────────────────────
  systemConfigs: router({
    list: adminProcedure.query(async () => getAllSystemConfigs()),
    upsert: adminProcedure
      .input(z.object({
        key: z.string().min(1),
        value: z.string(),
        description: z.string().optional(),
        category: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await upsertSystemConfig(input);
        return { success: true };
      }),
    batchUpsert: adminProcedure
      .input(z.array(z.object({
        key: z.string().min(1),
        value: z.string(),
        description: z.string().optional(),
        category: z.string().optional(),
      })))
      .mutation(async ({ input }) => {
        for (const config of input) await upsertSystemConfig(config);
        return { success: true };
      }),
  }),

  // ─── 操作日志 ───────────────────────────────────────────────────────────────────
  operationLogs: router({
    // 管理员：分页查询操作日志
    list: adminProcedure
      .input(z.object({
        action: z.string().optional(),
        userId: z.number().optional(),
        resourceCode: z.string().optional(),
        keyword: z.string().optional(),
        startTime: z.coerce.date().optional(),
        endTime: z.coerce.date().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(200).default(20),
      }))
      .query(async ({ input }) => listOperationLogs(input)),

    // 前端主动写入日志（用于下钻等客户端行为）
    logClient: protectedProcedure
      .input(z.object({
        action: z.enum(["drill_down", "view"]),
        resourceCode: z.string().min(1),
        resourceName: z.string().optional(),
        params: z.record(z.string(), z.any()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 验证 resourceCode 合法性，避免写入任意内容
        const plugin = ALL_REPORTS.find((p) => p.meta.code === input.resourceCode);
        if (!plugin) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "未知的报表编码" });
        }
        await logOperation({
          user: ctx.user,
          action: input.action,
          resourceType: "report",
          resourceCode: plugin.meta.code,
          resourceName: input.resourceName || plugin.meta.name,
          params: input.params ?? null,
          req: ctx.req,
        });
        return { success: true };
      }),
  }),

  // ─── 报表子路由（由 ReportPlugin 自动生成，新增报表只需在此追加一行）─────
  pkgWipSummary:        makeReportRouter(pkgWipSummary),
  outsourceOrderDetail: makeReportRouter(outsourceOrderDetail),
  pkgWipDetail:         makeReportRouter(pkgWipDetail),
  pkgWipInprocDetail:   makeReportRouter(pkgWipInprocDetail),
  pkgWipInprocSummary:  makeReportRouter(pkgWipInprocSummary),
  engPkgWip:            makeReportRouter(engPkgWip),
});

export type AppRouter = typeof appRouter;
