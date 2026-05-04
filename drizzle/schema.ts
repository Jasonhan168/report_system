import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

// ─── 用户表 ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  department: varchar("department", { length: 128 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  passwordHash: text("passwordHash"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── 数据源配置表 ──────────────────────────────────────────────────────────────
export const datasources = mysqlTable("datasources", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  type: mysqlEnum("type", ["mysql", "clickhouse", "oracle", "mock"]).notNull().default("mock"),
  host: varchar("host", { length: 256 }),
  port: int("port"),
  database: varchar("database", { length: 128 }),
  username: varchar("username", { length: 128 }),
  password: text("password"),
  extraOptions: json("extraOptions"),
  isDefault: boolean("isDefault").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Datasource = typeof datasources.$inferSelect;
export type InsertDatasource = typeof datasources.$inferInsert;

// ─── 报表模块注册表 ────────────────────────────────────────────────────────────
export const reportModules = mysqlTable("report_modules", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }),
  description: text("description"),
  datasourceId: int("datasourceId"),
  isActive: boolean("isActive").default(true).notNull(),
  route: varchar("route", { length: 256 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReportModule = typeof reportModules.$inferSelect;
export type InsertReportModule = typeof reportModules.$inferInsert;

// ─── 报表权限表 ────────────────────────────────────────────────────────────────
export const reportPermissions = mysqlTable("report_permissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  reportModuleId: int("reportModuleId").notNull(),
  canView: boolean("canView").default(false).notNull(),
  canExport: boolean("canExport").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReportPermission = typeof reportPermissions.$inferSelect;
export type InsertReportPermission = typeof reportPermissions.$inferInsert;

// ─── 系统配置表 ────────────────────────────────────────────────────────────────
export const systemConfigs = mysqlTable("system_configs", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  category: varchar("category", { length: 64 }).default("general"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemConfig = typeof systemConfigs.$inferSelect;
export type InsertSystemConfig = typeof systemConfigs.$inferInsert;

// ─── 用户操作日志表 ────────────────────────────────────────────────────────────
// 记录：登录/登出/登录失败、报表查看、报表导出、报表下钻 等用户操作。
export const operationLogs = mysqlTable("operation_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** 操作用户 id（登录失败时可为 null） */
  userId: int("userId"),
  /** 操作用户 openId（冗余，便于登录失败场景留痕） */
  userOpenId: varchar("userOpenId", { length: 64 }),
  /** 用户显示名 */
  userName: varchar("userName", { length: 128 }),
  /** 动作：login / login_failed / logout / view / export / drill_down */
  action: varchar("action", { length: 32 }).notNull(),
  /** 资源类型：report / auth */
  resourceType: varchar("resourceType", { length: 32 }),
  /** 资源编码（报表 code，如 pkg_wip_summary） */
  resourceCode: varchar("resourceCode", { length: 64 }),
  /** 资源显示名（报表中文名） */
  resourceName: varchar("resourceName", { length: 128 }),
  /** 查询条件 / 下钻参数 / 登录用户名等（JSON） */
  params: json("params"),
  /** 客户端 IP */
  ip: varchar("ip", { length: 64 }),
  /** UA 信息 */
  userAgent: text("userAgent"),
  /** 是否成功 */
  success: boolean("success").default(true).notNull(),
  /** 失败原因 */
  errorMsg: text("errorMsg"),
  /** 耗时（毫秒） */
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OperationLog = typeof operationLogs.$inferSelect;
export type InsertOperationLog = typeof operationLogs.$inferInsert;
