import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildInventoryReport, validateInventoryFile, validateInventoryRows } from "../src/index.js";
import { inventoryRows, tempDir, writeInventoryWorkbook } from "./helpers.js";

test("accepts a complete anonymous workbook and builds alert categories", async () => {
  const file = path.join(tempDir("cainiao-xlsx"), "inventory.xlsx");
  await writeInventoryWorkbook(file);
  const validation = await validateInventoryFile({ file, expectedSourceDate: "2026-07-16", minRows: 10 });
  assert.equal(validation.ok, true);
  assert.equal(validation.rowCount, 10);
  assert.equal(validation.totalQuantity, 135);
  const report = buildInventoryReport({
    rows: validation.rows,
    thresholds: { criticalDays: 7, urgentDays: 15, warningDays: 30 },
    maxRows: 30
  });
  assert.equal(report.skuCount, 10);
  assert.ok(report.criticalCount > 0);
  assert.match(report.markdown, /来源日期/);
});

test("accepts the default source date while blocking duplicate, unbalanced, and negative rows", () => {
  const rows = inventoryRows("2026-07-17", 10);
  rows[0]!["期末库存"] = 999;
  rows[1]!["货品条码"] = rows[0]!["货品条码"];
  rows[2]!["近30天销量"] = -1;
  const result = validateInventoryRows(rows, { expectedSourceDate: "2026-07-16", minRows: 10 });
  assert.equal(result.ok, false);
  assert.match(result.warnings.join("\n"), /数据延迟属于正常机制/);
  assert.match(result.errors.join("\n"), /库存不平/);
  assert.match(result.errors.join("\n"), /货品条码重复/);
  assert.match(result.errors.join("\n"), /不能为负数/);
});

test("a default export date mismatch is informational, not a validation failure", () => {
  const result = validateInventoryRows(inventoryRows("2026-07-15", 10), { expectedSourceDate: "2026-07-16", minRows: 10 });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /菜鸟默认来源日为 2026-07-15/);
});

test("accepts documented column aliases and rejects a genuinely missing required field", () => {
  const aliased = inventoryRows("2026-07-16", 10).map((row) => {
    const { "日期": date, "货品条码": sku, "入库汇总": inbound, "出库汇总": outbound, "近30天销量": sales, ...rest } = row;
    return { ...rest, "库存日期": date, "商品条码": sku, "入库合计": inbound, "出库合计": outbound, "30天销量": sales };
  });
  assert.equal(validateInventoryRows(aliased, { expectedSourceDate: "2026-07-16", minRows: 10 }).ok, true);
  const broken = aliased.map(({ "30天销量": _sales, ...row }) => row);
  const result = validateInventoryRows(broken, { expectedSourceDate: "2026-07-16", minRows: 10 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /缺少必需列：近30天销量/);
});

test("blocks adjacent-day discontinuity", () => {
  const previous = validateInventoryRows(inventoryRows("2026-07-15", 10), { expectedSourceDate: "2026-07-15", minRows: 10 }).rows;
  const current = inventoryRows("2026-07-16", 10);
  current[0]!["期初库存"] = 100;
  current[0]!["期末库存"] = 99;
  const result = validateInventoryRows(current, {
    expectedSourceDate: "2026-07-16",
    previousRows: previous,
    minRows: 10
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /跨日库存不连续/);
});

test("limits the visible report table without losing totals", () => {
  const rawRows = inventoryRows("2026-07-16", 40);
  for (const row of rawRows) row["近30天销量"] = 60;
  const rows = validateInventoryRows(rawRows, { expectedSourceDate: "2026-07-16", minRows: 10 }).rows;
  const report = buildInventoryReport({ rows, thresholds: { criticalDays: 7, urgentDays: 15, warningDays: 30 }, maxRows: 30 });
  assert.equal(report.skuCount, 40);
  assert.match(report.markdown, /其余 \d+ 个预警 SKU 已省略/);
});
