/**
 * 前端报表路由配置
 *
 * 新增报表只需：
 *   1) 在 pages/ 下实现页面组件
 *   2) 在下方 REPORT_ROUTES 追加一行 { path, component }
 */
import type { ComponentType } from "react";
import PkgWipSummary from "@/pages/PkgWipSummary";
import OutsourceOrderDetail from "@/pages/OutsourceOrderDetail";
import PkgWipDetail from "@/pages/PkgWipDetail";
import PkgWipInprocDetail from "@/pages/PkgWipInprocDetail";

export interface ReportRoute {
  path: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
}

export const REPORT_ROUTES: ReportRoute[] = [
  { path: "/reports/pkg-wip-summary",        component: PkgWipSummary },
  { path: "/reports/outsource-order-detail", component: OutsourceOrderDetail },
  { path: "/reports/pkg-wip-detail",         component: PkgWipDetail },
  { path: "/reports/pkg-wip-inproc-detail",  component: PkgWipInprocDetail },
];
