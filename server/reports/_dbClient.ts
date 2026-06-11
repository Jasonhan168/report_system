/**
 * 统一数据库客户端抽象层
 *
 * 为 ClickHouse 和 Doris 提供统一的查询接口，使报表插件无需关心底层驱动差异。
 * 同时暴露 engineType 供报表 SQL 根据引擎类型做兼容适配。
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Pool as MySqlPool } from "mysql2/promise";

// ─── 统一客户端接口 ──────────────────────────────────────────────────────────

export type EngineType = "clickhouse" | "doris";

export interface ReportDbClient {
  /** 执行 SQL 查询，返回类型化的行数组 */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** 引擎类型，报表 SQL 可据此做方言适配 */
  engineType: EngineType;
}

// ─── ClickHouse 适配器 ──────────────────────────────────────────────────────

export class ClickHouseAdapter implements ReportDbClient {
  readonly engineType: EngineType = "clickhouse";
  constructor(private client: ClickHouseClient) {}

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const result = await this.client.query({ query: sql, format: "JSONEachRow" });
    return result.json<T>();
  }
}

// ─── Doris 适配器（基于 MySQL 协议）────────────────────────────────────────

export class DorisAdapter implements ReportDbClient {
  readonly engineType: EngineType = "doris";
  constructor(private pool: MySqlPool) {}

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const [rows] = await this.pool.query(sql);
    return rows as T[];
  }
}

// ─── SQL 方言辅助工具 ────────────────────────────────────────────────────────
// 报表插件在拼 SQL 时调用以下工具函数，根据 engineType 生成对应引擎的语法。

/** 将表达式转为字符串类型 */
export function sqlCastStr(engine: EngineType, expr: string): string {
  return engine === "doris" ? `CAST(${expr} AS CHAR)` : `toString(${expr})`;
}

/** 将表达式转为 64 位整型 */
export function sqlCastInt64(engine: EngineType, expr: string): string {
  return engine === "doris" ? `CAST(${expr} AS BIGINT)` : `toInt64(${expr})`;
}

/** 获取当前日期 */
export function sqlToday(engine: EngineType): string {
  return engine === "doris" ? "CURDATE()" : "today()";
}

/** 空值处理（ifNull / IFNULL）—— 两者语法相同，保持 ifNull 即可 */
export function sqlIfNull(engine: EngineType, expr: string, fallback: string): string {
  // ClickHouse 和 Doris 都支持 ifNull 写法（Doris 大小写不敏感）
  return `ifNull(${expr}, ${fallback})`;
}

/** 聚合数组（返回 JSON 数组或逗号分隔字符串） */
export function sqlGroupArray(engine: EngineType, expr: string): string {
  return engine === "doris"
    ? `GROUP_CONCAT(${expr} SEPARATOR ',')`
    : `groupArray(${expr})`;
}

/** 聚合去重数组 */
export function sqlGroupUniqArray(engine: EngineType, expr: string): string {
  return engine === "doris"
    ? `GROUP_CONCAT(DISTINCT ${expr} ORDER BY ${expr} SEPARATOR ',')`
    : `groupUniqArray(${expr})`;
}

/**
 * 聚合去重数组（带条件）
 * ClickHouse: arraySort(groupUniqArrayIf(expr, cond))
 * Doris: GROUP_CONCAT(DISTINCT CASE WHEN cond THEN expr END ORDER BY expr)
 */
export function sqlGroupUniqArrayIf(engine: EngineType, expr: string, cond: string): string {
  return engine === "doris"
    ? `GROUP_CONCAT(DISTINCT CASE WHEN ${cond} THEN ${expr} END ORDER BY ${expr} SEPARATOR ',')`
    : `arraySort(groupUniqArrayIf(${expr}, ${cond}))`;
}

/** 数组连接为字符串 */
export function sqlArrayStringConcat(engine: EngineType, arrayExpr: string, separator: string): string {
  // 对 Doris，groupUniqArray 已通过 GROUP_CONCAT 返回字符串，无需再拼接
  // 此函数主要用于 ClickHouse: arrayStringConcat(arr, sep)
  return engine === "doris" ? arrayExpr : `arrayStringConcat(${arrayExpr}, '${separator}')`;
}

/** ClickHouse any() / Doris ANY_VALUE() */
export function sqlAny(engine: EngineType, expr: string): string {
  return engine === "doris" ? `ANY_VALUE(${expr})` : `any(${expr})`;
}

/**
 * 解析聚合数组结果。
 * ClickHouse 返回 JSON 数组（如 ["a","b"]），Doris 返回逗号分隔字符串（如 "a,b"）。
 * 统一转为 string[]。
 */
export function parseArrayResult(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    if (!raw) return [];
    // 可能是 JSON 格式 ["a","b"] 或逗号分隔 a,b
    if (raw.startsWith("[")) {
      try { return JSON.parse(raw) as string[]; } catch { /* fall through */ }
    }
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
