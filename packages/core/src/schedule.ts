import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { addDays, timePartsInZone } from "./dates.js";
import { loadConfig, saveConfig } from "./config.js";
import { readJson } from "./files.js";
import { runtimeMetadata } from "./browser.js";
import type { AppPaths } from "./paths.js";
import type { ScheduleConfig } from "./types.js";

export const LAUNCHD_LABEL = "com.907609732.cainiao-inventory";

export function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function scheduleInstalled(): boolean {
  return fs.existsSync(launchAgentPath());
}

export function installSchedule(paths: AppPaths, patch: Partial<ScheduleConfig> = {}): ScheduleConfig {
  if (process.platform !== "darwin") throw new Error("首版定时任务仅支持 macOS。");
  const metadata = runtimeMetadata(paths);
  if (!metadata?.nodePath || !metadata.cliPath || !fs.existsSync(metadata.cliPath)) {
    throw new Error("稳定 CLI 运行时尚未准备，请先完成设置向导的运行环境步骤。");
  }
  const config = saveConfig(paths, { schedule: { ...loadConfig(paths).schedule, ...patch, enabled: true } }).schedule;
  const plist = buildPlist({ paths, schedule: config, nodePath: metadata.nodePath, cliPath: metadata.cliPath });
  const file = launchAgentPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, plist, { mode: 0o600 });
  try { execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, file], { stdio: "ignore" }); } catch {}
  execFileSync("/bin/launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, file]);
  return config;
}

export function removeSchedule(paths: AppPaths): void {
  const file = launchAgentPath();
  if (fs.existsSync(file)) {
    try { execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, file], { stdio: "ignore" }); } catch {}
    fs.rmSync(file, { force: true });
  }
  const config = loadConfig(paths);
  saveConfig(paths, { schedule: { ...config.schedule, enabled: false } });
}

export function dueQueryDate(paths: AppPaths, now = new Date()): { due: boolean; queryDate: string; reason: string } {
  const schedule = loadConfig(paths).schedule;
  if (!schedule.enabled) return { due: false, queryDate: "", reason: "schedule_disabled" };
  const parts = timePartsInZone(now, schedule.timeZone);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const targetMinutes = schedule.hour * 60 + schedule.minute;
  const queryDate = currentMinutes >= targetMinutes ? parts.date : addDays(parts.date, -1);
  const elapsedMinutes = currentMinutes >= targetMinutes
    ? currentMinutes - targetMinutes
    : currentMinutes + 24 * 60 - targetMinutes;
  if (elapsedMinutes > schedule.catchUpHours * 60) return { due: false, queryDate, reason: "catch_up_window_expired" };
  const state = readJson<{ lastSuccessfulSendQueryDate?: string; deliveryUnknownQueryDate?: string }>(paths.state, {});
  if (state.deliveryUnknownQueryDate === queryDate) {
    return { due: false, queryDate, reason: "delivery_unknown_requires_manual_retry" };
  }
  if (state.lastSuccessfulSendQueryDate === queryDate) return { due: false, queryDate, reason: "already_succeeded" };
  return { due: true, queryDate, reason: elapsedMinutes === 0 ? "on_time" : "catch_up" };
}

function buildPlist(options: { paths: AppPaths; schedule: ScheduleConfig; nodePath: string; cliPath: string }): string {
  const out = path.join(options.paths.logs, "launchd.out.log");
  const err = path.join(options.paths.logs, "launchd.err.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(options.nodePath)}</string><string>${xml(options.cliPath)}</string><string>scheduled-run</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>${xml(os.homedir())}</string><key>CAINIAO_APP_ROOT</key><string>${xml(options.paths.root)}</string></dict>
  <key>StartInterval</key><integer>${options.schedule.checkIntervalSeconds}</integer>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>${xml(out)}</string>
  <key>StandardErrorPath</key><string>${xml(err)}</string>
</dict>
</plist>
`;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
