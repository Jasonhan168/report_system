import { QueryCache, QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

let identity: string | undefined;
let redirecting = false;
const isMe = (key: readonly unknown[]) =>
  JSON.stringify(key[0]) === '["auth","me"]';

export function clearSessionCache(broadcast = false) {
  void queryClient.cancelQueries();
  queryClient.clear();
  identity = undefined;
  localStorage.removeItem("manus-runtime-user-info");
  if (broadcast)
    localStorage.setItem("report-auth-event", `${Date.now()}:${Math.random()}`);
}

function leavePage(path: string) {
  if (redirecting) return;
  redirecting = true;
  window.location.replace(path);
}

export function handleAccessError(error: unknown) {
  if (!(error instanceof TRPCClientError)) return;
  const code = error.data?.code;
  if (code !== "UNAUTHORIZED" && code !== "FORBIDDEN") return;
  clearSessionCache();
  if (window.location.pathname === "/login") return;
  if (code === "UNAUTHORIZED") leavePage("/login");
  else leavePage("/?access=changed");
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => {
        if (
          error instanceof TRPCClientError &&
          ["UNAUTHORIZED", "FORBIDDEN"].includes(error.data?.code ?? "")
        )
          return false;
        return count < 1;
      },
    },
  },
  queryCache: new QueryCache({
    onError: handleAccessError,
    onSuccess: (data, query) => {
      if (!isMe(query.queryKey)) return;
      const user = data as {
        id: number;
        role: string;
        authType: string;
        dataScope: string;
        companyId: number | null;
        hasDataAccess: boolean;
      } | null;
      const next = user
        ? JSON.stringify([
            user.id,
            user.role,
            user.authType,
            user.dataScope,
            user.companyId,
            user.hasDataAccess,
          ])
        : "anonymous";
      if (identity !== undefined && identity !== next) {
        clearSessionCache();
        leavePage(user ? "/" : "/login");
      }
      identity = next;
      if (!user && window.location.pathname !== "/login") {
        clearSessionCache();
        leavePage("/login");
      }
    },
  }),
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error")
    handleAccessError(event.mutation.state.error);
});

// 同一浏览器其他标签页切换账号时，取消旧请求并重新读取服务端会话。
window.addEventListener("storage", event => {
  if (event.key !== "report-auth-event") return;
  clearSessionCache();
  leavePage("/");
});

export async function sessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const response = await globalThis.fetch(input, {
    ...init,
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    clearSessionCache();
    if (window.location.pathname !== "/login") {
      if (response.status === 401) leavePage("/login");
      else leavePage("/?access=changed");
    }
  }
  return response;
}
