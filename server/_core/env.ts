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
};
