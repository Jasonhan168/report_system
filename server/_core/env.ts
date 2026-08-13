export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "local-dev-secret-change-in-production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // AUTH_MODE: "local" = 本地账号密码登录（测试环境）
  //            "ldap"  = AD域LDAP登录（生产环境）
  //            "oauth" = Manus OAuth登录（云端部署）
  authMode: (process.env.AUTH_MODE ?? "local") as "local" | "ldap" | "oauth",
  // 启动时是否同步报表插件元数据（name/category/description/route/sortOrder）到数据库。
  // true  = 每次启动覆盖（默认，开发/测试环境保持元数据最新）
  // false = 仅插入新模块，不覆盖已有记录（生产环境避免覆盖管理员后台修改）
  syncReportMetaOnStartup: process.env.SYNC_REPORT_META_ON_STARTUP !== "false",
  // WIP 日报接收状态更新 API Key（外部解析系统调用 /api/wip-daily-status/update 时鉴权）
  wipStatusApiKey: process.env.WIP_STATUS_API_KEY ?? "",
};
