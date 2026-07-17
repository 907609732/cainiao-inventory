import fs from "node:fs";
import { ensureDir, readJson, writeJsonAtomic } from "./files.js";
import type { AutomationConfig } from "./types.js";
import type { AppPaths } from "./paths.js";

export const DEFAULT_CONFIG: AutomationConfig = {
  schemaVersion: 1,
  businessTimeZone: "Asia/Shanghai",
  reportPolicy: null,
  minRows: 10,
  continuityOverlap: 0.8,
  maxReportRows: 30,
  alertThresholds: { criticalDays: 7, urgentDays: 15, warningDays: 30 },
  retention: { rawDays: 30, logDays: 30, diagnosticDays: 7 },
  schedule: {
    enabled: false,
    hour: 22,
    minute: 0,
    timeZone: "Asia/Shanghai",
    catchUpHours: 24,
    checkIntervalSeconds: 900
  },
  callback: { enabled: false }
};

export function ensureAppLayout(paths: AppPaths): void {
  for (const dir of [
    paths.root,
    paths.runtime,
    paths.browserProfile,
    paths.browsers,
    paths.downloads,
    paths.snapshots,
    paths.runs,
    paths.reports,
    paths.logs,
    paths.diagnostics
  ]) ensureDir(dir);
  if (!fs.existsSync(paths.config)) writeJsonAtomic(paths.config, DEFAULT_CONFIG);
}

export function loadConfig(paths: AppPaths): AutomationConfig {
  ensureAppLayout(paths);
  let saved: Partial<AutomationConfig>;
  try {
    saved = JSON.parse(fs.readFileSync(paths.config, "utf8")) as Partial<AutomationConfig>;
  } catch (error) {
    throw new Error(`配置文件损坏，无法安全运行：${error instanceof Error ? error.message : String(error)}`);
  }
  const savedVersion = Number(saved.schemaVersion ?? 0);
  if (savedVersion > DEFAULT_CONFIG.schemaVersion) {
    throw new Error(`配置版本 ${savedVersion} 高于当前支持的版本 ${DEFAULT_CONFIG.schemaVersion}，请先升级插件。`);
  }
  const migrated: AutomationConfig = {
    ...DEFAULT_CONFIG,
    ...saved,
    alertThresholds: { ...DEFAULT_CONFIG.alertThresholds, ...(saved.alertThresholds || {}) },
    retention: { ...DEFAULT_CONFIG.retention, ...(saved.retention || {}) },
    schedule: { ...DEFAULT_CONFIG.schedule, ...(saved.schedule || {}) },
    callback: { ...DEFAULT_CONFIG.callback, ...(saved.callback || {}) },
    schemaVersion: 1
  };
  validateConfig(migrated);
  if (JSON.stringify(saved) !== JSON.stringify(migrated)) writeJsonAtomic(paths.config, migrated);
  return migrated;
}

export function saveConfig(paths: AppPaths, patch: Partial<AutomationConfig>): AutomationConfig {
  const current = loadConfig(paths);
  const next: AutomationConfig = {
    ...current,
    ...patch,
    alertThresholds: { ...current.alertThresholds, ...(patch.alertThresholds || {}) },
    retention: { ...current.retention, ...(patch.retention || {}) },
    schedule: { ...current.schedule, ...(patch.schedule || {}) },
    callback: { ...current.callback, ...(patch.callback || {}) },
    schemaVersion: 1
  };
  validateConfig(next);
  writeJsonAtomic(paths.config, next);
  return next;
}

export function validateConfig(config: AutomationConfig): void {
  if (config.reportPolicy !== null && !["always", "critical_only"].includes(config.reportPolicy)) {
    throw new Error("日报策略必须是 always 或 critical_only。");
  }
  if (config.minRows < 1) throw new Error("最少库存行数必须大于 0。");
  if (config.continuityOverlap < 0 || config.continuityOverlap > 1) throw new Error("连续性重合比例必须在 0 到 1 之间。");
  if (config.maxReportRows < 1 || config.maxReportRows > 100) throw new Error("报告明细行数必须在 1 到 100 之间。");
  const { criticalDays, urgentDays, warningDays } = config.alertThresholds;
  if (!(criticalDays > 0 && criticalDays < urgentDays && urgentDays < warningDays)) {
    throw new Error("预警阈值必须依次递增且大于 0。");
  }
  if (config.schedule.hour < 0 || config.schedule.hour > 23) throw new Error("定时小时必须在 0 到 23 之间。");
  if (config.schedule.minute < 0 || config.schedule.minute > 59) throw new Error("定时分钟必须在 0 到 59 之间。");
  if (config.schedule.catchUpHours < 0 || config.schedule.catchUpHours > 168) throw new Error("补跑窗口必须在 0 到 168 小时之间。");
  if (config.schedule.checkIntervalSeconds < 60) throw new Error("定时检查间隔不能少于 60 秒。");
  for (const timeZone of [config.businessTimeZone, config.schedule.timeZone]) {
    try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
    catch { throw new Error(`无效时区：${timeZone}`); }
  }
}
