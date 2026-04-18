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
