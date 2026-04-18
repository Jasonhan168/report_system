/**
 * 数据源连接工厂
 * 根据 datasources 表中的配置动态创建 ClickHouse / MySQL / Mock 连接
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { Datasource } from "../drizzle/schema";

// 缓存已创建的 ClickHouse 客户端（按数据源 id）
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
