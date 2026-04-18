#!/usr/bin/env node
/**
 * 创建管理员账号脚本
 * 用法：node scripts/create-admin.mjs
 *
 * 依赖：
 *   - 已配置 .env 文件（含 DATABASE_URL）
 *   - 已执行数据库初始化脚本 init-db.sql
 */

import { createConnection } from "mysql2/promise";
import { createHash, randomBytes } from "crypto";
import { readFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// ─── 加载 .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    console.error("❌ 未找到 .env 文件，请先复制 .env.example 并填写配置");
    process.exit(1);
  }
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── bcrypt 替代（纯 Node.js，无需 native 模块）────────────────────────────────
// 注意：此脚本使用 bcryptjs 的 PBKDF2 兼容哈希，与应用程序保持一致
// 如果 bcryptjs 可用则使用，否则提示安装
async function hashPassword(password) {
  try {
    // 尝试动态导入 bcryptjs
    const { default: bcrypt } = await import("bcryptjs");
    return bcrypt.hash(password, 12);
  } catch {
    console.error("❌ 未找到 bcryptjs 模块，请先执行：pnpm install");
    process.exit(1);
  }
}

// ─── 交互式输入 ───────────────────────────────────────────────────────────────
function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      // 隐藏密码输入
      process.stdout.write(question);
      let password = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", function handler(char) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", handler);
          process.stdout.write("\n");
          resolve(password);
        } else if (char === "\u0003") {
          process.exit();
        } else if (char === "\u007f") {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          password += char;
          process.stdout.write("*");
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║     报表查询系统 - 创建管理员账号     ║");
  console.log("╚══════════════════════════════════════╝\n");

  loadEnv();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL 未配置，请检查 .env 文件");
    process.exit(1);
  }

  // 获取输入
  const username = await prompt("请输入管理员用户名（英文，如 admin）：");
  if (!username || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
    console.error("❌ 用户名只能包含字母、数字、下划线、点和连字符");
    process.exit(1);
  }

  const displayName = await prompt("请输入显示名称（如 系统管理员）：");
  if (!displayName) {
    console.error("❌ 显示名称不能为空");
    process.exit(1);
  }

  const password = await prompt("请输入密码（至少6位）：", true);
  if (!password || password.length < 6) {
    console.error("❌ 密码至少6位");
    process.exit(1);
  }

  const confirmPassword = await prompt("请再次输入密码确认：", true);
  if (password !== confirmPassword) {
    console.error("❌ 两次密码不一致");
    process.exit(1);
  }

  console.log("\n⏳ 正在连接数据库...");

  let conn;
  try {
    conn = await createConnection(dbUrl);
    console.log("✅ 数据库连接成功");
  } catch (err) {
    console.error("❌ 数据库连接失败：", err.message);
    process.exit(1);
  }

  try {
    // 检查用户名是否已存在
    const [existing] = await conn.execute(
      "SELECT id FROM users WHERE openId = ?",
      [username]
    );
    if (existing.length > 0) {
      console.error(`❌ 用户名 "${username}" 已存在`);
      process.exit(1);
    }

    // 哈希密码
    console.log("⏳ 正在生成密码哈希...");
    const passwordHash = await hashPassword(password);

    // 插入管理员用户
    await conn.execute(
      `INSERT INTO users (openId, name, loginMethod, role, isActive, passwordHash, lastSignedIn)
       VALUES (?, ?, 'local', 'admin', TRUE, ?, NOW())`,
      [username, displayName, passwordHash]
    );

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║         ✅ 管理员账号创建成功！        ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(`\n  用户名：${username}`);
    console.log(`  显示名：${displayName}`);
    console.log(`  角色：  管理员（admin）`);
    console.log(`\n  请使用以上账号登录系统：http://localhost:3000\n`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("❌ 执行失败：", err.message);
  process.exit(1);
});
