import fs from "node:fs";
import path from "node:path";
import type ExcelJS from "exceljs";
import { previousSourceDate } from "./dates.js";
import type { InventoryRow, ValidationResult } from "./types.js";

type RawRow = Record<string, unknown>;

type ColumnKey = "date" | "sku" | "name" | "externalProductId" | "beginning" | "inbound" | "outbound" | "ending" | "near30DaysSales";
const REQUIRED_COLUMN_KEYS: ColumnKey[] = ["date", "sku", "beginning", "inbound", "outbound", "ending", "near30DaysSales"];

const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  date: ["日期", "库存日期"],
  sku: ["货品条码", "条码", "商品条码"],
  name: ["货品名称", "商品名称", "名称"],
  externalProductId: ["外部商品ID", "外部商品id", "商品ID", "商品id"],
  beginning: ["期初库存"],
  inbound: ["入库汇总", "入库合计"],
  outbound: ["出库汇总", "出库合计"],
  ending: ["期末库存", "当前仓库存", "库存数量"],
  near30DaysSales: ["近30天销量", "近30天销售", "30天销量"]
};

export async function readInventoryWorkbook(file: string): Promise<RawRow[]> {
  const stat = fs.statSync(file);
  if (stat.size > 50 * 1024 * 1024) throw new Error("库存 Excel 超过 50MB 安全上限。");
  const { default: ExcelJSRuntime } = await import("exceljs");
  const workbook = new ExcelJSRuntime.Workbook();
  await workbook.xlsx.readFile(file);
  const candidate = findHeader(workbook);
  if (!candidate) return [];
  const { sheet, rowNumber } = candidate;
  const headerRow = sheet.getRow(rowNumber);
  const headers: Array<{ column: number; name: string }> = [];
  for (let column = 1; column <= Math.max(sheet.columnCount, headerRow.cellCount); column += 1) {
    const name = text(excelValue(headerRow.getCell(column).value));
    if (name) headers.push({ column, name });
  }
  const rows: RawRow[] = [];
  for (let rowNumber = candidate.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const value = Object.fromEntries(headers.map(({ column, name }) => [name, excelValue(row.getCell(column).value)]));
    if (Object.values(value).some((cell) => text(cell) !== "")) rows.push(value);
  }
  return rows;
}

function findHeader(workbook: ExcelJS.Workbook): { sheet: ExcelJS.Worksheet; rowNumber: number; score: number } | null {
  const allAliases = new Set(Object.values(COLUMN_ALIASES).flat());
  let best: { sheet: ExcelJS.Worksheet; rowNumber: number; score: number } | null = null;
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
      const values = new Set<string>();
      const row = sheet.getRow(rowNumber);
      for (let column = 1; column <= Math.max(sheet.columnCount, row.cellCount); column += 1) {
        values.add(text(excelValue(row.getCell(column).value)));
      }
      const score = [...allAliases].filter((header) => values.has(header)).length;
      if (score >= 2 && (!best || score > best.score)) best = { sheet, rowNumber, score };
    }
  }
  return best;
}

function excelValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
  }
  return value;
}

export async function validateInventoryFile(options: {
  file: string;
  expectedSourceDate: string;
  previousRows?: InventoryRow[];
  minRows?: number;
  continuityOverlap?: number;
}): Promise<ValidationResult> {
  const rows = await readInventoryWorkbook(options.file);
  return validateInventoryRows(rows, {
    file: options.file,
    expectedSourceDate: options.expectedSourceDate,
    previousRows: options.previousRows,
    minRows: options.minRows,
    continuityOverlap: options.continuityOverlap
  });
}

export function validateInventoryRows(rawRows: RawRow[], options: {
  file?: string;
  expectedSourceDate: string;
  previousRows?: InventoryRow[];
  minRows?: number;
  continuityOverlap?: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const minRows = options.minRows ?? 10;
  const continuityOverlap = options.continuityOverlap ?? 0.8;
  const headers = Object.keys(rawRows[0] || {});
  const resolved = Object.fromEntries((Object.entries(COLUMN_ALIASES) as Array<[ColumnKey, string[]]>).map(([key, aliases]) => [
    key,
    aliases.find((alias) => headers.includes(alias)) || ""
  ])) as Record<ColumnKey, string>;
  const missingColumns = REQUIRED_COLUMN_KEYS.filter((key) => !resolved[key]).map((key) => COLUMN_ALIASES[key][0]);
  if (missingColumns.length) errors.push(`缺少必需列：${missingColumns.join("、")}`);
  if (rawRows.length < minRows) errors.push(`库存行数过少：${rawRows.length}，最低要求 ${minRows}`);

  const sourceDates = new Set<string>();
  const seen = new Set<string>();
  const rows: InventoryRow[] = [];
  let totalQuantity = 0;
  let invalidFormulaCount = 0;
  let invalidNumberCount = 0;
  let duplicateCount = 0;

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const sourceDate = parseDailyPeriod(raw[resolved.date]);
    if (!sourceDate) errors.push(`第 ${rowNumber} 行日期不是单日范围：${text(raw[resolved.date]) || "空"}`);
    else sourceDates.add(sourceDate);

    const sku = text(raw[resolved.sku]);
    if (!sku) {
      errors.push(`第 ${rowNumber} 行货品条码为空`);
      return;
    }
    if (seen.has(sku)) {
      duplicateCount += 1;
      errors.push(`货品条码重复：${sku}`);
      return;
    }
    seen.add(sku);

    const numericKeys = ["beginning", "inbound", "outbound", "ending", "near30DaysSales"] as const;
    const values = {} as Record<(typeof numericKeys)[number], number>;
    for (const key of numericKeys) {
      const rawValue = raw[resolved[key]];
      const parsed = number(rawValue);
      if (!Number.isFinite(parsed)) {
        invalidNumberCount += 1;
        errors.push(`第 ${rowNumber} 行 ${resolved[key] || key} 不是有效数字`);
        values[key] = 0;
      } else {
        values[key] = parsed;
        if (parsed < 0) errors.push(`第 ${rowNumber} 行 ${resolved[key] || key} 不能为负数`);
      }
    }

    const calculated = values.beginning + values.inbound - values.outbound;
    if (Math.abs(calculated - values.ending) > 0.001) {
      invalidFormulaCount += 1;
      errors.push(`第 ${rowNumber} 行 ${sku} 库存不平：${values.beginning} + ${values.inbound} - ${values.outbound} != ${values.ending}`);
    }
    totalQuantity += values.ending;
    rows.push({
      sourceDate,
      sku,
      name: text(raw[resolved.name]),
      externalProductId: text(raw[resolved.externalProductId]),
      ...values
    });
  });

  if (sourceDates.size !== 1) errors.push(`库存文件必须只有一个来源日期，实际为：${[...sourceDates].join("、") || "空"}`);
  const sourceDate = sourceDates.size === 1 ? [...sourceDates][0]! : "";
  if (sourceDate && sourceDate !== options.expectedSourceDate) {
    warnings.push(`菜鸟默认来源日为 ${sourceDate}，任务参考日的前一日为 ${options.expectedSourceDate}；平台数据延迟属于正常机制。`);
  }

  let overlapCount = 0;
  const previousRows = options.previousRows || [];
  if (previousRows.length && sourceDate) {
    const previousDate = new Set(previousRows.map((row) => row.sourceDate));
    if (previousDate.size === 1 && [...previousDate][0] === previousSourceDate(sourceDate)) {
      const previousBySku = new Map(previousRows.map((row) => [row.sku, row]));
      const discontinuities: string[] = [];
      for (const row of rows) {
        const previous = previousBySku.get(row.sku);
        if (!previous) continue;
        overlapCount += 1;
        if (Math.abs(previous.ending - row.beginning) > 0.001) {
          discontinuities.push(`${row.sku}: 前日 ${previous.ending}，本日期初 ${row.beginning}`);
        }
      }
      const minimumOverlap = Math.ceil(Math.min(rows.length, previousRows.length) * continuityOverlap);
      if (overlapCount < minimumOverlap) errors.push(`与前日库存重合 SKU 过少：${overlapCount}/${minimumOverlap}`);
      if (discontinuities.length) errors.push(`跨日库存不连续：${discontinuities.slice(0, 8).join("；")}`);
    } else {
      warnings.push("最近快照不是相邻来源日，已跳过跨日连续性校验。");
    }
  } else if (!previousRows.length) {
    warnings.push("这是首个有效快照，暂无前一日基线。");
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? "invalid" : "valid",
    file: path.basename(options.file || ""),
    sourceDate,
    expectedSourceDate: options.expectedSourceDate,
    rowCount: rawRows.length,
    skuCount: rows.length,
    totalQuantity,
    invalidFormulaCount,
    invalidNumberCount,
    duplicateCount,
    overlapCount,
    errors,
    warnings,
    rows
  };
}

function parseDailyPeriod(value: unknown): string {
  const matches = text(value).match(/\d{4}-\d{2}-\d{2}/g) || [];
  return matches.length && matches.every((date) => date === matches[0]) ? matches[0]! : "";
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  const normalized = text(value).replace(/,/g, "");
  return normalized === "" ? Number.NaN : Number(normalized);
}
