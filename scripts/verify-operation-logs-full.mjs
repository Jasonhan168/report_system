/**
 * 全链路验证：登录 → 查询 → 导出 → 下钻 → 登出 → 管理端 list
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const DB_URL = process.env.DATABASE_URL;
const BASE = process.env.VERIFY_BASE_URL || "http://localhost:3002";

const conn = await mysql.createConnection(DB_URL);
const [[before]] = await conn.execute(
  "SELECT COUNT(*) AS cnt FROM operation_logs",
);
console.log(`起始日志数：${before.cnt}`);

// ─── 1. 登录 admin 并抓取 session cookie ───────────────────────
async function trpc(endpoint, payload, cookie, method = "POST") {
  const headers = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${BASE}/api/trpc/${endpoint}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ json: payload }),
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return { status: res.status, text, setCookie };
}

console.log("\n━━━ [1] 登录 admin ━━━");
let r = await trpc("auth.login", { username: "admin", password: "admin123" });
console.log(`  HTTP ${r.status}  cookie=${r.setCookie?.substring(0, 60)}...`);
const cookie = r.setCookie?.split(";")[0];
if (!cookie) {
  console.error("❌ 登录失败，未获得 cookie");
  process.exit(1);
}

// ─── 2. 报表查询 pkgWipSummary ───────────────────────────────
console.log("\n━━━ [2] 调用 pkgWipSummary.query（GET） ━━━");
{
  const input = { date: "2026-05-01", page: 1, pageSize: 10 };
  const url = `${BASE}/api/trpc/pkgWipSummary.query?input=${encodeURIComponent(
    JSON.stringify({ json: input }),
  )}`;
  const res = await fetch(url, { headers: { cookie } });
  const text = await res.text();
  console.log(`  HTTP ${res.status}  →  ${text.substring(0, 160)}`);
}

// ─── 3. 报表导出（GET /api/export/pkg_wip_summary） ─────────
console.log("\n━━━ [3] 调用 /api/export/pkg_wip_summary ━━━");
try {
  const res = await fetch(`${BASE}/api/export/pkg-wip-summary?date=2026-05-01`, {
    headers: { cookie },
  });
  console.log(
    `  HTTP ${res.status}  content-type=${res.headers.get("content-type")}  size=${res.headers.get("content-length") ?? "?"}`,
  );
} catch (err) {
  console.log(`  失败：${err.message}`);
}

// ─── 4. 下钻日志上报 ───────────────────────────────────────
console.log("\n━━━ [4] 调用 operationLogs.logClient（drill_down） ━━━");
r = await trpc(
  "operationLogs.logClient",
  {
    action: "drill_down",
    resourceCode: "pkg_wip_detail",
    resourceName: "封装厂在制品明细",
    params: { fromCode: "pkg_wip_summary", queryString: "factory=FX1" },
  },
  cookie,
);
console.log(`  HTTP ${r.status}  →  ${r.text.substring(0, 120)}`);

// ─── 5. 登出 ─────────────────────────────────────────────
console.log("\n━━━ [5] 调用 auth.logout ━━━");
r = await trpc("auth.logout", {}, cookie);
console.log(`  HTTP ${r.status}  →  ${r.text.substring(0, 120)}`);

// ─── 6. 管理端 list 接口 ──────────────────────────────────
console.log("\n━━━ [6] 重新登录后调用 operationLogs.list ━━━");
r = await trpc("auth.login", { username: "admin", password: "admin123" });
const cookie2 = r.setCookie?.split(";")[0];
const listUrl = `${BASE}/api/trpc/operationLogs.list?input=${encodeURIComponent(
  JSON.stringify({ json: { page: 1, pageSize: 5 } }),
)}`;
const listRes = await fetch(listUrl, { headers: { cookie: cookie2 } });
const listBody = await listRes.text();
console.log(`  HTTP ${listRes.status}  →  ${listBody.substring(0, 280)}...`);

// ─── 7. 等待异步写入并查数据库 ──────────────────────────────
await new Promise((r) => setTimeout(r, 1200));
console.log("\n━━━ [7] 数据库最新 15 条日志 ━━━");
const [rows] = await conn.execute(
  `SELECT id, action, userOpenId, userName, resourceCode, success,
          SUBSTRING(errorMsg,1,30) AS errorMsg, durationMs, ip,
          CAST(params AS CHAR) AS params, createdAt
     FROM operation_logs ORDER BY id DESC LIMIT 15`,
);
console.table(rows);

const [[after]] = await conn.execute(
  "SELECT COUNT(*) AS cnt FROM operation_logs",
);
console.log(
  `\n本次验证新增 ${after.cnt - before.cnt} 条日志（共 ${after.cnt} 条）`,
);

// ─── 8. 按 action 统计 ──────────────────────────────────
const [stats] = await conn.execute(
  "SELECT action, COUNT(*) AS cnt FROM operation_logs GROUP BY action ORDER BY cnt DESC",
);
console.log("\n各类操作统计：");
console.table(stats);

await conn.end();
console.log("\n✅ 验证完成");
