import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

export function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

export function inventoryRows(date = "2026-07-16", count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    "日期": `${date}~${date}`,
    "外部商品ID": `product-${index + 1}`,
    "货品条码": `SKU-${String(index + 1).padStart(3, "0")}`,
    "货品名称": `匿名商品 ${index + 1}`,
    "期初库存": 10 + index,
    "入库汇总": 2,
    "出库汇总": 3,
    "期末库存": 9 + index,
    "近30天销量": index % 3 === 0 ? 60 : 15
  }));
}

export async function writeInventoryWorkbook(file: string, rows = inventoryRows()): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("sheet1");
  const headers = Object.keys(rows[0] || {});
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((header) => (row as Record<string, unknown>)[header]));
  await workbook.xlsx.writeFile(file);
}

export function okDingTalkResponse(): Response {
  return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
