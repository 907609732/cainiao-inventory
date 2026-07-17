import type { AlertThresholds, InventoryReport, InventoryReportItem, InventoryRow } from "./types.js";

const LABELS = {
  critical: "🔴 不够卖 1 周",
  urgent: "🟠 不够卖半个月",
  warning: "🟡 不够卖 1 个月",
  ok: "🟢 正常"
} as const;

export function buildInventoryReport(options: {
  rows: InventoryRow[];
  thresholds: AlertThresholds;
  maxRows?: number;
  acceptanceLabel?: string;
}): InventoryReport {
  const maxRows = options.maxRows ?? 30;
  const items: InventoryReportItem[] = options.rows.map((row) => {
    const dailySales = row.near30DaysSales > 0 ? row.near30DaysSales / 30 : 0;
    const sellableDays = dailySales > 0 ? row.ending / dailySales : null;
    let alertLevel: InventoryReportItem["alertLevel"] = "ok";
    if (sellableDays !== null && sellableDays < options.thresholds.criticalDays) alertLevel = "critical";
    else if (sellableDays !== null && sellableDays < options.thresholds.urgentDays) alertLevel = "urgent";
    else if (sellableDays !== null && sellableDays < options.thresholds.warningDays) alertLevel = "warning";
    return { ...row, sellableDays, alertLevel, alertText: LABELS[alertLevel] };
  }).sort((a, b) => levelOrder(a.alertLevel) - levelOrder(b.alertLevel) || days(a) - days(b) || a.sku.localeCompare(b.sku));

  const alertItems = items.filter((item) => item.alertLevel !== "ok");
  const criticalCount = items.filter((item) => item.alertLevel === "critical").length;
  const urgentCount = items.filter((item) => item.alertLevel === "urgent").length;
  const warningCount = items.filter((item) => item.alertLevel === "warning").length;
  const sourceDate = options.rows[0]?.sourceDate || "";
  const titlePrefix = options.acceptanceLabel ? `${options.acceptanceLabel} ` : "";
  const title = `${titlePrefix}菜鸟库存日报 ${sourceDate}`.trim();
  const detail = alertItems.length
    ? buildTable(alertItems.slice(0, maxRows))
    : "✅ 暂无预计一个月内需要补货的 SKU。";
  const truncated = alertItems.length > maxRows ? `\n\n其余 ${alertItems.length - maxRows} 个预警 SKU 已省略。` : "";
  const totalQuantity = options.rows.reduce((sum, row) => sum + row.ending, 0);
  const markdown = [
    `## ${title}`,
    "",
    `来源日期：**${sourceDate}**｜SKU：**${items.length}**｜库存合计：**${totalQuantity}**`,
    `少于 1 周：**${criticalCount}**｜少于半个月：**${urgentCount}**｜少于 1 个月：**${warningCount}**`,
    "",
    "库存/销量表示期末库存与近 30 天销量；同一 SKU 仅展示一次。",
    "",
    detail,
    truncated
  ].filter((line) => line !== "").join("\n");

  return {
    sourceDate,
    generatedAt: new Date().toISOString(),
    skuCount: items.length,
    totalQuantity,
    criticalCount,
    urgentCount,
    warningCount,
    shouldNotify: criticalCount > 0,
    title,
    markdown,
    items
  };
}

function buildTable(items: InventoryReportItem[]): string {
  const header = "| SKU | 库存/销量 | 天数 | 预警 |\n|---|---|---|---|";
  const rows = items.map((item) => {
    const shortName = item.name.replace(item.sku, "").trim().slice(0, 10);
    const sku = escapeCell(shortName ? `${item.sku}<br>${shortName}` : item.sku);
    const sellableDays = item.sellableDays === null ? "—" : String(Math.round(item.sellableDays));
    return `| ${sku} | ${item.ending} / ${item.near30DaysSales} | ${sellableDays} | ${item.alertText} |`;
  });
  return [header, ...rows].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function levelOrder(level: InventoryReportItem["alertLevel"]): number {
  return { critical: 0, urgent: 1, warning: 2, ok: 3 }[level];
}

function days(item: InventoryReportItem): number {
  return item.sellableDays === null ? Number.POSITIVE_INFINITY : item.sellableDays;
}
