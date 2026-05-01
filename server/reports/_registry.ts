/**
 * 报表插件注册中心
 *
 * 新增报表只需：
 *   1) 在本目录新建 xxx.ts 文件实现并 default export 一个 ReportPlugin
 *   2) 在本文件 ALL_REPORTS 数组中追加 import & 一行
 *
 * 之后：
 *   - routers.ts 会通过 makeReportRouter 自动生成 tRPC 子路由
 *   - export.ts  会自动注册 GET /api/export/<code> 接口
 *   - db.ts      会自动 upsert report_modules 默认记录
 */
import type { ReportPlugin } from "./_types";

import pkgWipSummary from "./pkg-wip-summary";
import outsourceOrderDetail from "./outsource-order-detail";
import pkgWipDetail from "./pkg-wip-detail";
import pkgWipInprocDetail from "./pkg-wip-inproc-detail";
import pkgWipInprocSummary from "./pkg-wip-inproc-summary";

/** 所有报表插件（顺序无意义，展示排序由 meta.sortOrder 决定） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_REPORTS: ReportPlugin<any, any, any, any, any, any>[] = [
  pkgWipSummary,
  outsourceOrderDetail,
  pkgWipDetail,
  pkgWipInprocDetail,
  pkgWipInprocSummary,
];

export { pkgWipSummary, outsourceOrderDetail, pkgWipDetail, pkgWipInprocDetail, pkgWipInprocSummary };
