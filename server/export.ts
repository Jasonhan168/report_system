import { Router } from "express";
import ExcelJS from "exceljs";
import { sdk } from "./_core/sdk";
import { checkUserReportPermission, getReportModuleByCode, getReportModuleDatasource, getAllUsers } from "./db";
import { generateMockWipData, type WipRecord } from "./mockData";
import { getClickHouseClient } from "./datasource";
import { exportWipData } from "./queries/pkg-wip-summary";
import { exportOutsourceOrderDetail } from "./queries/outsource-order-detail";
import { exportWipDetail } from "./queries/pkg-wip-detail";
import { COOKIE_NAME } from "@shared/const";

/** 通用：从请求中解析用户 */
async function resolveUser(req: { headers: { cookie?: string } }) {
  const cookieHeader = req.headers.cookie || "";
  const cookieMap = new Map(
    cookieHeader.split(";").map((c) => c.trim().split("=").map(decodeURIComponent) as [string, string])
  );
  const sessionToken = cookieMap.get(COOKIE_NAME);
  if (!sessionToken) return null;
  const payload = await sdk.verifySession(sessionToken);
  if (!payload) return null;
  const allUsers = await getAllUsers();
  const user = allUsers.find((u) => u.openId === payload.openId);
  if (!user || !user.isActive) return null;
  return user;
}

export function registerExportRoutes(app: Router) {
  // GET /api/export/pkg-wip-summary?date=YYYY-MM-DD&labelName=...&vendorName=...
  app.get("/api/export/pkg-wip-summary", async (req, res) => {
    try {
      const user = await resolveUser(req);
      if (!user) { res.status(401).json({ error: "未登录或会话已过期" }); return; }

      if (user.role !== "admin") {
        const module = await getReportModuleByCode("pkg_wip_summary");
        if (!module) { res.status(403).json({ error: "无导出权限" }); return; }
        const allowed = await checkUserReportPermission(user.id, module.id, "export");
        if (!allowed) { res.status(403).json({ error: "无导出权限" }); return; }
      }

      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const labelName = (req.query.labelName as string) || "";
      const vendorName = (req.query.vendorName as string) || "";

      let rows: WipRecord[] = [];
      let totalRow: WipRecord | undefined;

      const ds = await getReportModuleDatasource("pkg_wip_summary");
      if (ds && ds.type === "clickhouse") {
        const client = getClickHouseClient(ds);
        const result = await exportWipData(client, { date, labelName, vendorName });
        rows = result.data;
        totalRow = result.totalRow;
      } else {
        const result = generateMockWipData({ date, labelName, vendorName, page: 1, pageSize: 99999 });
        rows = result.data;
        totalRow = result.totalRow;
      }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("封装厂WIP汇总表");

      ws.mergeCells("A1:J1");
      const titleCell = ws.getCell("A1");
      titleCell.value = `封装厂WIP汇总表  ${date}`;
      titleCell.font = { bold: true, size: 14, name: "微软雅黑" };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 30;

      const headers = ["标签品名", "供应商料号", "供应商", "未投数量", "装片", "焊线", "塑封", "测试", "测试后-入库", "合计WIP数量"];
      const headerRow = ws.addRow(headers);
      headerRow.height = 22;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headerRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 10, name: "微软雅黑", color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: "FFB8C8E0" } }, bottom: { style: "thin", color: { argb: "FFB8C8E0" } }, left: { style: "thin", color: { argb: "FFB8C8E0" } }, right: { style: "thin", color: { argb: "FFB8C8E0" } } };
      });

      rows.forEach((row, idx) => {
        const dataRow = ws.addRow([row.label_name, row.vendor_part_no, row.vendor_name, row.unissued_qty, row.die_attach, row.wire_bond, row.molding, row.testing, row.test_done, row.wip_qty]);
        dataRow.height = 18;
        const bgColor = idx % 2 === 0 ? "FFFFFFFF" : "FFF5F7FA";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dataRow.eachCell((cell: any, colNum: number) => {
          cell.font = { size: 10, name: "微软雅黑" };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.alignment = { horizontal: colNum <= 3 ? "left" : "center", vertical: "middle" };
          cell.border = { top: { style: "hair", color: { argb: "FFE0E8F0" } }, bottom: { style: "hair", color: { argb: "FFE0E8F0" } }, left: { style: "hair", color: { argb: "FFE0E8F0" } }, right: { style: "hair", color: { argb: "FFE0E8F0" } } };
        });
      });

      if (totalRow) {
        const tr = ws.addRow(["合计", "", "", totalRow.unissued_qty, totalRow.die_attach, totalRow.wire_bond, totalRow.molding, totalRow.testing, totalRow.test_done, totalRow.wip_qty]);
        tr.height = 20;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tr.eachCell((cell: any) => {
          cell.font = { bold: true, size: 10, name: "微软雅黑" };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { top: { style: "thin", color: { argb: "FF1E3A5F" } }, bottom: { style: "thin", color: { argb: "FF1E3A5F" } }, left: { style: "thin", color: { argb: "FFB8C8E0" } }, right: { style: "thin", color: { argb: "FFB8C8E0" } } };
        });
      }

      [28, 18, 18, 12, 10, 10, 10, 10, 14, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      ws.views = [{ state: "frozen", ySplit: 2 }];

      const filename = encodeURIComponent(`封装厂WIP汇总表_${date}.xlsx`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("[Export] pkg-wip-summary error:", err);
      if (!res.headersSent) res.status(500).json({ error: "导出失败，请重试" });
    }
  });

  // GET /api/export/outsource-order-detail?date=...&vendorName=...&labelName=...&vendorPartNo=...&plant=...&productionType=...
  app.get("/api/export/outsource-order-detail", async (req, res) => {
    try {
      const user = await resolveUser(req);
      if (!user) { res.status(401).json({ error: "未登录或会话已过期" }); return; }

      if (user.role !== "admin") {
        const module = await getReportModuleByCode("outsource_order_detail");
        if (!module) { res.status(403).json({ error: "无导出权限" }); return; }
        const allowed = await checkUserReportPermission(user.id, module.id, "export");
        if (!allowed) { res.status(403).json({ error: "无导出权限" }); return; }
      }

      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const vendorName = (req.query.vendorName as string) || "";
      const labelName = (req.query.labelName as string) || "";
      const vendorPartNo = (req.query.vendorPartNo as string) || "";
      const plant = (req.query.plant as string) || "";
      const productionType = (req.query.productionType as string) || "";

      const ds = await getReportModuleDatasource("outsource_order_detail");
      if (!ds || ds.type !== "clickhouse") {
        res.status(400).json({ error: "数据源未配置" });
        return;
      }

      const client = getClickHouseClient(ds);
      const rows = await exportOutsourceOrderDetail(client, { date, vendorName, labelName, vendorPartNo, plant, productionType });

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("委外订单明细表");

      // 标题行
      ws.mergeCells("A1:M1");
      const titleCell = ws.getCell("A1");
      titleCell.value = `委外订单明细表  ${date}`;
      titleCell.font = { bold: true, size: 14, name: "微软雅黑" };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 30;

      const headers = ["订单号", "订单日期", "工序类型", "工程量产", "委外厂商", "料号", "批号", "标签品名", "供应商料号", "订单数量", "未回货数量", "回货率(%)", "分公司"];
      const headerRow = ws.addRow(headers);
      headerRow.height = 22;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headerRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 10, name: "微软雅黑", color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: "FFB8C8E0" } }, bottom: { style: "thin", color: { argb: "FFB8C8E0" } }, left: { style: "thin", color: { argb: "FFB8C8E0" } }, right: { style: "thin", color: { argb: "FFB8C8E0" } } };
      });

      rows.forEach((row, idx) => {
        const dataRow = ws.addRow([
          row.order_no, row.order_date, row.process_type, row.production_type,
          row.vendor_name, row.part_no, row.lot_no, row.lable, row.vendor_part_no,
          row.qty, row.open_qty, row.received_rate, row.plant,
        ]);
        dataRow.height = 18;
        const bgColor = idx % 2 === 0 ? "FFFFFFFF" : "FFF5F7FA";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dataRow.eachCell((cell: any, colNum: number) => {
          cell.font = { size: 10, name: "微软雅黑" };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.alignment = { horizontal: colNum <= 9 ? "left" : "center", vertical: "middle" };
          cell.border = { top: { style: "hair", color: { argb: "FFE0E8F0" } }, bottom: { style: "hair", color: { argb: "FFE0E8F0" } }, left: { style: "hair", color: { argb: "FFE0E8F0" } }, right: { style: "hair", color: { argb: "FFE0E8F0" } } };
        });
      });

      [16, 12, 12, 12, 18, 14, 12, 20, 18, 12, 12, 12, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      ws.views = [{ state: "frozen", ySplit: 2 }];

      const nameParts = ["委外订单明细表", date];
      if (vendorName) nameParts.push(vendorName);
      else if (labelName) nameParts.push(labelName);
      const filename = encodeURIComponent(`${nameParts.join("_")}.xlsx`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("[Export] outsource-order-detail error:", err);
      if (!res.headersSent) res.status(500).json({ error: "导出失败，请重试" });
    }
  });

  // GET /api/export/pkg-wip-detail?date=...&vendorName=...&labelName=...&vendorPartNo=...
  app.get("/api/export/pkg-wip-detail", async (req, res) => {
    try {
      const user = await resolveUser(req);
      if (!user) { res.status(401).json({ error: "未登录或会话已过期" }); return; }

      if (user.role !== "admin") {
        const module = await getReportModuleByCode("pkg_wip_detail");
        if (!module) { res.status(403).json({ error: "无导出权限" }); return; }
        const allowed = await checkUserReportPermission(user.id, module.id, "export");
        if (!allowed) { res.status(403).json({ error: "无导出权限" }); return; }
      }

      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const vendorName = (req.query.vendorName as string) || "";
      const labelName = (req.query.labelName as string) || "";
      const vendorPartNo = (req.query.vendorPartNo as string) || "";

      const ds = await getReportModuleDatasource("pkg_wip_detail");
      if (!ds || ds.type !== "clickhouse") {
        res.status(400).json({ error: "数据源未配置" });
        return;
      }

      const client = getClickHouseClient(ds);
      const rows = await exportWipDetail(client, { date, vendorName, labelName, vendorPartNo });

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("封装厂WIP明细表");

      // 标题行
      ws.mergeCells("A1:K1");
      const titleCell = ws.getCell("A1");
      titleCell.value = `封装厂WIP明细表  ${date}`;
      titleCell.font = { bold: true, size: 14, name: "微软雅黑" };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 30;

      const headers = ["日期", "委外厂商", "委外订单号", "标签品名", "供应商料号", "批号", "装片", "焊线", "塑封", "测试", "测试后"];
      const headerRow = ws.addRow(headers);
      headerRow.height = 22;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headerRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 10, name: "微软雅黑", color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: "FFB8C8E0" } }, bottom: { style: "thin", color: { argb: "FFB8C8E0" } }, left: { style: "thin", color: { argb: "FFB8C8E0" } }, right: { style: "thin", color: { argb: "FFB8C8E0" } } };
      });

      rows.forEach((row, idx) => {
        const dataRow = ws.addRow([
          row.date, row.vendor_name, row.order_no, row.label_name, row.vendor_part_no, row.batch_no,
          row.die_attach, row.wire_bond, row.molding, row.testing, row.test_done,
        ]);
        dataRow.height = 18;
        const bgColor = idx % 2 === 0 ? "FFFFFFFF" : "FFF5F7FA";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dataRow.eachCell((cell: any, colNum: number) => {
          cell.font = { size: 10, name: "微软雅黑" };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.alignment = { horizontal: colNum <= 6 ? "left" : "center", vertical: "middle" };
          cell.border = { top: { style: "hair", color: { argb: "FFE0E8F0" } }, bottom: { style: "hair", color: { argb: "FFE0E8F0" } }, left: { style: "hair", color: { argb: "FFE0E8F0" } }, right: { style: "hair", color: { argb: "FFE0E8F0" } } };
        });
      });

      [12, 18, 16, 20, 18, 14, 10, 10, 10, 10, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      ws.views = [{ state: "frozen", ySplit: 2 }];

      const nameParts = ["封装厂WIP明细表", date];
      if (vendorName) nameParts.push(vendorName);
      else if (labelName) nameParts.push(labelName);
      const filename = encodeURIComponent(`${nameParts.join("_")}.xlsx`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("[Export] pkg-wip-detail error:", err);
      if (!res.headersSent) res.status(500).json({ error: "导出失败，请重试" });
    }
  });
}
