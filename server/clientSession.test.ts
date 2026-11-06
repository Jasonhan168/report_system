import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";

let replace: ReturnType<typeof vi.fn>;
let storage: Map<string, string>;
let events: Map<string, Function>;
beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  events = new Map();
  replace = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/reports/test", replace },
    addEventListener: (key: string, fn: Function) => events.set(key, fn),
  });
  vi.stubGlobal("localStorage", {
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("清理查询、用户资料并通知其他标签页", async () => {
  const { queryClient, clearSessionCache } = await import(
    "../client/src/lib/session"
  );
  queryClient.setQueryData(["old-report"], [{ secret: "A公司" }]);
  storage.set("manus-runtime-user-info", "old-user");
  clearSessionCache(true);
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
  expect(storage.has("manus-runtime-user-info")).toBe(false);
  expect(storage.has("report-auth-event")).toBe(true);
});
it("403 不保留上一账号业务结果", async () => {
  const { queryClient, handleAccessError } = await import(
    "../client/src/lib/session"
  );
  queryClient.setQueryData(["old-report"], [1]);
  const error = new TRPCClientError("没有权限", {
    result: { error: { data: { code: "FORBIDDEN" } } } as any,
  });
  handleAccessError(error);
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
  expect(replace).toHaveBeenCalledWith("/?access=changed");
});
it("账号切换时取消未完成请求，迟到结果不能恢复缓存", async () => {
  const { queryClient, clearSessionCache } = await import(
    "../client/src/lib/session"
  );
  let finish!: (rows: number[]) => void;
  const pending = queryClient
    .fetchQuery({
      queryKey: ["report"],
      queryFn: () =>
        new Promise<number[]>(resolve => {
          finish = resolve;
        }),
    })
    .catch(() => undefined);
  clearSessionCache();
  finish([42]);
  await pending;
  expect(queryClient.getQueryData(["report"])).toBeUndefined();
});
it("跨标签页账号变化清空缓存并重载", async () => {
  const { queryClient } = await import("../client/src/lib/session");
  queryClient.setQueryData(["report"], [1]);
  events.get("storage")!({ key: "report-auth-event" });
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
  expect(replace).toHaveBeenCalledWith("/");
});
it("REST 会话失效和权限错误同样清理缓存", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
  const { queryClient, sessionFetch } = await import(
    "../client/src/lib/session"
  );
  queryClient.setQueryData(["report"], [1]);
  await sessionFetch("/api/export/test");
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
  expect(replace).toHaveBeenCalledWith("/login");
});
