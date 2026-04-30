import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  users, datasources, reportModules, reportPermissions, systemConfigs,
  InsertUser, InsertDatasource, InsertReportModule, InsertReportPermission, InsertSystemConfig,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── 用户 ──────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(users.createdAt);
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function updateUserActive(userId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ isActive }).where(eq(users.id, userId));
}

// ─── 数据源 ────────────────────────────────────────────────────────────────────
export async function getAllDatasources() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(datasources).orderBy(datasources.createdAt);
}

export async function getDatasourceById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(datasources).where(eq(datasources.id, id)).limit(1);
  return result[0];
}

export async function createDatasource(data: Omit<InsertDatasource, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) return;
  await db.insert(datasources).values(data as InsertDatasource);
}

export async function updateDatasource(id: number, data: Partial<InsertDatasource>) {
  const db = await getDb();
  if (!db) return;
  await db.update(datasources).set(data).where(eq(datasources.id, id));
}

export async function deleteDatasource(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(datasources).where(eq(datasources.id, id));
}

/** 获取默认数据源（isDefault=true 的第一条，若无则取第一条） */
export async function getDefaultDatasource() {
  const db = await getDb();
  if (!db) return undefined;
  const all = await db.select().from(datasources)
    .where(eq(datasources.isActive, true))
    .orderBy(desc(datasources.isDefault), datasources.createdAt)
    .limit(10);
  // 优先返回 isDefault=true 的
  return all.find((d) => d.isDefault) ?? all[0];
}

/** 获取报表模块关联的数据源；若未关联则返回默认数据源 */
export async function getReportModuleDatasource(moduleCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const modules = await db.select().from(reportModules)
    .where(eq(reportModules.code, moduleCode)).limit(1);
  const mod = modules[0];
  if (mod?.datasourceId) {
    return getDatasourceById(mod.datasourceId);
  }
  return getDefaultDatasource();
}

// ─── 报表模块 ──────────────────────────────────────────────────────────────────
export async function getAllReportModules() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reportModules).orderBy(reportModules.sortOrder);
}

export async function getReportModuleByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reportModules).where(eq(reportModules.code, code)).limit(1);
  return result[0];
}

export async function createReportModule(data: Omit<InsertReportModule, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) return;
  await db.insert(reportModules).values(data as InsertReportModule);
}

export async function updateReportModule(id: number, data: Partial<InsertReportModule>) {
  const db = await getDb();
  if (!db) return;
  await db.update(reportModules).set(data).where(eq(reportModules.id, id));
}

// ─── 报表权限 ──────────────────────────────────────────────────────────────────
export async function getPermissionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reportPermissions).where(eq(reportPermissions.userId, userId));
}

export async function getPermissionsByReportId(reportModuleId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reportPermissions).where(eq(reportPermissions.reportModuleId, reportModuleId));
}

export async function upsertReportPermission(data: {
  userId: number;
  reportModuleId: number;
  canView: boolean;
  canExport: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  // 先删除已有记录，再插入新记录（兼容无唯一索引的旧版 MySQL）
  await db
    .delete(reportPermissions)
    .where(
      and(
        eq(reportPermissions.userId, data.userId),
        eq(reportPermissions.reportModuleId, data.reportModuleId)
      )
    );
  await db.insert(reportPermissions).values(data);
}

export async function checkUserReportPermission(
  userId: number,
  reportModuleId: number,
  type: "view" | "export"
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .select()
    .from(reportPermissions)
    .where(
      and(
        eq(reportPermissions.userId, userId),
        eq(reportPermissions.reportModuleId, reportModuleId)
      )
    )
    .limit(1);
  if (!result[0]) return false;
  return type === "view" ? result[0].canView : result[0].canExport;
}

export async function getAllPermissionsWithUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reportPermissions);
}

// ─── 系统配置 ──────────────────────────────────────────────────────────────────
export async function getAllSystemConfigs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(systemConfigs).orderBy(systemConfigs.category);
}

export async function getSystemConfigByKey(key: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key)).limit(1);
  return result[0];
}

export async function upsertSystemConfig(data: {
  key: string;
  value: string;
  description?: string;
  category?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(systemConfigs).values(data).onDuplicateKeyUpdate({
    set: { value: data.value },
  });
}

// ─── 初始化默认数据 ────────────────────────────────────────────────────────────
let _initialized = false;

export async function initDefaultData() {
  if (_initialized) return;
  _initialized = true;

  const db = await getDb();
  if (!db) return;

  // 默认Mock数据源
  const existingDs = await getAllDatasources();
  if (existingDs.length === 0) {
    await db.insert(datasources).values({
      name: "演示数据源（Mock）",
      type: "mock",
      isDefault: true,
      isActive: true,
    });
  }

  // 默认报表模块
  const defaultModules = [
    {
      code: "pkg_wip_summary",
      name: "封装厂WIP汇总表",
      category: "封装厂报表",
      description: "展示封装厂各工序在制品（WIP）汇总数据，支持按日期、标签品名、供应商查询",
      route: "/reports/pkg-wip-summary",
      isActive: true,
      sortOrder: 1,
    },
    {
      code: "outsource_order_detail",
      name: "委外订单明细表",
      category: "生产报表",
      description: "按日期查询委外订单明细，received_rate<98为固定条件",
      route: "/reports/outsource-order-detail",
      isActive: true,
      sortOrder: 20,
    },
    {
      code: "pkg_wip_detail",
      name: "原封装厂WIP明细表",
      category: "生产报表",
      description: "按日期查询封装厂WIP明细数据（来源：v_dwd_ab_wip）",
      route: "/reports/pkg-wip-detail",
      isActive: true,
      sortOrder: 30,
    },
    {
      code: "pkg_wip_inproc_detail",
      name: "封装厂在制品明细表",
      category: "生产报表",
      description: "封装厂在制品当前快照明细（来源：v_dws_ab_wip，带进度更新时间）",
      route: "/reports/pkg-wip-inproc-detail",
      isActive: true,
      sortOrder: 40,
    },
  ];
  const existingModules = await getAllReportModules();
  const existingCodes = new Set(existingModules.map((m) => m.code));
  for (const mod of defaultModules) {
    if (!existingCodes.has(mod.code)) {
      await db.insert(reportModules).values(mod);
    }
  }

  // 兼容老数据：若旧封装厂WIP明细表名称未更新，则重命名为“原封装厂WIP明细表”
  await db
    .update(reportModules)
    .set({ name: "原封装厂WIP明细表" })
    .where(and(eq(reportModules.code, "pkg_wip_detail"), eq(reportModules.name, "封装厂WIP明细表")))
    .catch(() => {});

  // 默认系统配置
  const defaultConfigs = [
    { key: "ad_server_url", value: "", description: "AD域服务器地址", category: "auth" },
    { key: "ad_domain", value: "", description: "AD域名称", category: "auth" },
    { key: "ad_base_dn", value: "", description: "AD Base DN", category: "auth" },
    { key: "ad_bind_user", value: "", description: "AD绑定用户", category: "auth" },
    { key: "system_name", value: "西山居报表查询系统", description: "系统名称", category: "general" },
    { key: "company_name", value: "", description: "公司名称", category: "general" },
  ];

  for (const config of defaultConfigs) {
    const existing = await getSystemConfigByKey(config.key);
    if (!existing) {
      await db.insert(systemConfigs).values(config);
    }
  }
}
