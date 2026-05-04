/** 验证 /api/export/operation-logs 导出链路 */
import fs from "node:fs";
import mysql from "mysql2/promise";
import "dotenv/config";

const BASE = process.env.VERIFY_BASE_URL || "http://localhost:3000";
const conn = await mysql.createConnection(process.env.DATABASE_URL);

async function trpcLogin(username, password) {
  const res = await fetch(`${BASE}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { username, password } }),
  });
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

// ─── 1. admin 登录 + 导出 ───
console.log("━━━ [1] admin 登录并导出 ━━━");
const r = await trpcLogin("admin", "admin123");
console.log(`  登录 HTTP ${r.status}`);
if (!r.cookie) process.exit(1);

const url = `${BASE}/api/export/operation-logs?startTime=${new Date(Date.now() - 7 * 86400000).toISOString()}&endTime=${new Date().toISOString()}`;
const exp = await fetch(url, { headers: { cookie: r.cookie } });
console.log(
  `  导出 HTTP ${exp.status}  content-type=${exp.headers.get("content-type")}  disposition=${exp.headers.get("content-disposition")}`,
);

if (exp.status === 200) {
  const buf = Buffer.from(await exp.arrayBuffer());
  const path = "scripts/_out-operation-logs.xlsx";
  fs.writeFileSync(path, buf);
  console.log(`  ✅ 文件已保存：${path}（${buf.length} bytes）`);
  // 读首 4 字节检查是否 PK 头
  console.log(`  文件头（应为 50 4B 03 04）：${buf.slice(0, 4).toString("hex").toUpperCase()}`);
}

// ─── 2. 非管理员尝试导出 ───
console.log("\n━━━ [2] 无 cookie 访问（应 401） ━━━");
const noAuth = await fetch(url);
console.log(`  HTTP ${noAuth.status}  →  ${(await noAuth.text()).substring(0, 80)}`);

// ─── 3. 检查导出日志被自记录 ───
await new Promise((r) => setTimeout(r, 800));
console.log("\n━━━ [3] 数据库内 resourceCode='operation_logs' 的 export 日志 ━━━");
const [rows] = await conn.execute(
  `SELECT id, action, userOpenId, resourceCode, success, SUBSTRING(errorMsg,1,40) AS errorMsg, durationMs, createdAt
     FROM operation_logs
    WHERE resourceCode = 'operation_logs' ORDER BY id DESC LIMIT 5`,
);
console.table(rows);

await conn.end();
console.log("\n✅ 导出验证完成");
