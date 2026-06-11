/**
 * 数据源连接工厂
 * 根据 datasources 表中的配置动态创建 ClickHouse / Doris / MySQL / Mock 连接
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { createPool, type Pool as MySqlPool } from "mysql2/promise";
import type { Datasource } from "../drizzle/schema";
import { ClickHouseAdapter, DorisAdapter, type ReportDbClient } from "./reports/_dbClient";

// ─── ClickHouse 客户端缓存 ──────────────────────────────────────────────────
const _chClients = new Map<number, ClickHouseClient>();

/**
 * 根据数据源记录创建（或复用缓存的）ClickHouse 客户端
 */
export function getClickHouseClient(ds: Datasource): ClickHouseClient {
  const cached = _chClients.get(ds.id);
  if (cached) return cached;

  const protocol = (ds.extraOptions as any)?.ssl ? "https" : "http";
  const host = `${protocol}://${ds.host ?? "localhost"}:${ds.port ?? 8123}`;

  const client = createClient({
    url: host,
    database: ds.database ?? "default",
    username: ds.username ?? "default",
    password: ds.password ?? "",
    request_timeout: 30_000,
    compression: { response: true, request: false },
  });

  _chClients.set(ds.id, client);
  return client;
}

/**
 * 清除指定数据源的连接缓存（数据源配置变更后调用）
 */
export function invalidateClickHouseClient(dsId: number) {
  const client = _chClients.get(dsId);
  if (client) {
    client.close().catch(() => {});
    _chClients.delete(dsId);
  }
}

/**
 * 测试 ClickHouse 连接是否可用
 */
export async function testClickHouseConnection(ds: Datasource): Promise<{ ok: boolean; message: string }> {
  try {
    const client = getClickHouseClient(ds);
    const result = await client.query({ query: "SELECT 1", format: "JSONEachRow" });
    await result.json();
    return { ok: true, message: "连接成功" };
  } catch (err: any) {
    // 连接失败时清除缓存，下次重新创建
    invalidateClickHouseClient(ds.id);
    return { ok: false, message: err?.message ?? "连接失败" };
  }
}

// ─── Doris 连接池缓存（Doris 兼容 MySQL 协议）─────────────────────────────────
const _dorisClients = new Map<number, MySqlPool>();

/**
 * 根据数据源记录创建（或复用缓存的）Doris 连接池
 */
export function getDorisPool(ds: Datasource): MySqlPool {
  const cached = _dorisClients.get(ds.id);
  if (cached) return cached;

  const pool = createPool({
    host: ds.host ?? "localhost",
    port: ds.port ?? 9030,
    database: ds.database ?? "wip_db",
    user: ds.username ?? "root",
    password: ds.password ?? "",
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 30_000,
  });

  _dorisClients.set(ds.id, pool);
  return pool;
}

/**
 * 清除指定 Doris 数据源的连接缓存
 */
export function invalidateDorisClient(dsId: number) {
  const pool = _dorisClients.get(dsId);
  if (pool) {
    pool.end().catch(() => {});
    _dorisClients.delete(dsId);
  }
}

/**
 * 测试 Doris 连接是否可用
 */
export async function testDorisConnection(ds: Datasource): Promise<{ ok: boolean; message: string }> {
  try {
    const pool = getDorisPool(ds);
    const [rows] = await pool.query("SELECT 1 AS ok");
    void rows;
    return { ok: true, message: "Doris 连接成功" };
  } catch (err: any) {
    invalidateDorisClient(ds.id);
    return { ok: false, message: err?.message ?? "Doris 连接失败" };
  }
}

// ─── 统一获取报表数据库客户端 ────────────────────────────────────────────────

/**
 * 根据数据源配置返回统一的 ReportDbClient（ClickHouse 或 Doris）
 */
export function getReportDbClient(ds: Datasource): ReportDbClient {
  if (ds.type === "doris") {
    return new DorisAdapter(getDorisPool(ds));
  }
  // 默认 ClickHouse
  return new ClickHouseAdapter(getClickHouseClient(ds));
}

/**
 * 清除指定数据源的连接缓存（自动判断类型）
 */
export function invalidateReportClient(ds: Datasource) {
  if (ds.type === "doris") {
    invalidateDorisClient(ds.id);
  } else {
    invalidateClickHouseClient(ds.id);
  }
}
