export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** 会话空闲超时时间：8 小时无操作后登录失效 */
export const SESSION_IDLE_TIMEOUT_MS = 1000 * 60 * 60 * 8;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
