import { TRPCError } from "@trpc/server";
import type { ReportAccessContext } from "../reportAccess";
export type { ReportAccessContext } from "../reportAccess";

export type ScopedView =
  | "v_dwd_order"
  | "v_dwd_order_agg"
  | "v_dwd_order_wip"
  | "v_dwd_ab_wip"
  | "v_dwd_ab_wip_agg"
  | "v_dws_ab_wip"
  | "v_dws_ab_wip_agg";

export function scopedSource(
  view: ScopedView,
  access: ReportAccessContext
): string {
  if (!access)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "缺少服务端数据权限上下文",
    });
  if (access.scope === "all") return view;
  if (access.scope !== "own" || !access.plant)
    throw new TRPCError({ code: "FORBIDDEN", message: "分公司权限无效" });
  const plant = access.plant.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  // 对完整订单历史做唯一归属判定；不以 WHERE plant 预过滤掩盖冲突。
  // IN 子查询不扩大WIP行数；未知、空值及多公司归属全部拒绝开放。
  return `(SELECT * FROM ${view} WHERE order_no IN (
    SELECT order_no FROM v_dwd_order
    WHERE ifNull(order_no, '') != ''
    GROUP BY order_no
    HAVING min(ifNull(plant, '')) = '${plant}' AND max(ifNull(plant, '')) = '${plant}'
  ))`;
}
