import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dateInTimeZone, isIsoDate, previousSourceDate } from "./dates.js";
import { loadConfig, saveConfig } from "./config.js";
import { resolveAppPaths, type AppPaths } from "./paths.js";
import { KeychainSecretStore } from "./keychain.js";
import { readJson, removeOlderThan, writeJsonAtomic } from "./files.js";
import { buildInventoryReport } from "./report.js";
import { readInventoryWorkbook, validateInventoryRows } from "./validation.js";
import { runBrowserWorker, runtimeReady } from "./browser.js";
import { DeliveryUnknownError, SECRET_ACCOUNTS, sendCallback, sendDingTalk, sha256 } from "./delivery.js";
import {
  deliveryKey,
  findLatestDelivery,
  findSuccessfulDelivery,
  getLastRun,
  getRun,
  listRuns,
  recordDelivery,
  saveRun,
  updateState
} from "./ledger.js";
import { acquireRunLock, readActiveLock } from "./run-lock.js";
import { installSchedule, removeSchedule, scheduleInstalled } from "./schedule.js";
import type {
  AutomationConfig,
  AutomationDependencies,
  AutomationStatus,
  BrowserWorkerResult,
  DeliveryResult,
  DoctorResult,
  InventoryReport,
  InventoryRow,
  RunRequest,
  RunResult,
  RetryDeliveryResult,
  ScheduleConfig,
  SecretStore,
  ValidationResult
} from "./types.js";

export class CainiaoInventoryAutomation {
  readonly paths: AppPaths;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly secrets: SecretStore;
  private readonly browserRunner: NonNullable<AutomationDependencies["browserRunner"]>;

  constructor(dependencies: AutomationDependencies = {}) {
    this.paths = resolveAppPaths(dependencies.appRoot || process.env.CAINIAO_APP_ROOT);
    this.now = dependencies.now || (() => new Date());
    this.fetchImpl = dependencies.fetch || fetch;
    this.secrets = dependencies.secretStore || new KeychainSecretStore();
    this.browserRunner = dependencies.browserRunner || ((request) => runBrowserWorker(this.paths, request));
    loadConfig(this.paths);
  }

  config(): AutomationConfig {
    return loadConfig(this.paths);
  }

  configure(patch: Partial<AutomationConfig>): AutomationConfig {
    return saveConfig(this.paths, patch);
  }

  async setSecrets(values: { dingtalkWebhook?: string; dingtalkSecret?: string; callbackUrl?: string; callbackToken?: string }): Promise<void> {
    const mapping: Array<[keyof typeof values, string]> = [
      ["dingtalkWebhook", SECRET_ACCOUNTS.dingtalkWebhook],
      ["dingtalkSecret", SECRET_ACCOUNTS.dingtalkSecret],
      ["callbackUrl", SECRET_ACCOUNTS.callbackUrl],
      ["callbackToken", SECRET_ACCOUNTS.callbackToken]
    ];
    for (const [key, account] of mapping) {
      if (values[key] !== undefined) await this.secrets.set(account, values[key] || "");
    }
  }

  async doctor(): Promise<DoctorResult> {
    const config = this.config();
    const state = readJson<Record<string, unknown>>(this.paths.state, {});
    const webhook = await this.secrets.get(SECRET_ACCOUNTS.dingtalkWebhook);
    const checks = [
      {
        id: "platform",
        ok: process.platform === "darwin",
        required: true,
        message: process.platform === "darwin" ? "macOS 平台受支持。" : `当前平台 ${process.platform} 不在 v1 支持范围。`,
        fix: "请在 macOS 13 或更高版本使用。"
      },
      {
        id: "runtime",
        ok: runtimeReady(this.paths),
        required: true,
        message: runtimeReady(this.paths) ? "隔离浏览器运行时已准备。" : "隔离浏览器运行时尚未准备。",
        fix: "打开设置向导并执行准备运行环境。"
      },
      {
        id: "login",
        ok: Boolean(state.loggedInAt),
        required: true,
        message: state.loggedInAt ? `菜鸟登录已在 ${state.loggedInAt} 验证。` : "尚未验证菜鸟登录。",
        fix: "在设置向导打开专用浏览器并完成一次登录。"
      },
      {
        id: "report_policy",
        ok: config.reportPolicy !== null,
        required: true,
        message: config.reportPolicy ? `日报策略：${config.reportPolicy}。` : "尚未选择日报发送策略。",
        fix: "在设置向导选择每天发送或仅严重预警发送。"
      },
      {
        id: "dingtalk",
        ok: Boolean(webhook),
        required: true,
        message: webhook ? "钉钉 Webhook 已安全存入 Keychain。" : "尚未配置钉钉 Webhook。",
        fix: "在设置向导填写 Webhook；不要把 token 发到聊天中。"
      },
      {
        id: "schedule",
        ok: !config.schedule.enabled || scheduleInstalled(),
        required: false,
        message: scheduleInstalled() ? "launchd 定时任务已安装。" : "launchd 定时任务尚未安装。",
        fix: "完成真实 dry-run 后在设置向导启用。"
      }
    ];
    return {
      ready: checks.filter((check) => check.required).every((check) => check.ok),
      platform: process.platform,
      architecture: process.arch,
      appRoot: this.paths.root,
      checks
    };
  }

  async login(): Promise<BrowserWorkerResult> {
    const result = await this.browserRunner({
      action: "login",
      profileDir: this.paths.browserProfile,
      storageStateFile: this.paths.browserAuth,
      diagnosticsDir: this.paths.diagnostics
    });
    if (result.ok && result.loggedIn) updateState(this.paths, { loggedInAt: this.now().toISOString() });
    return result;
  }

  async testDingTalk(label = "【插件连接测试】"): Promise<DeliveryResult> {
    const date = dateInTimeZone(this.now(), this.config().businessTimeZone);
    const report: InventoryReport = {
      sourceDate: date,
      generatedAt: this.now().toISOString(),
      skuCount: 0,
      totalQuantity: 0,
      criticalCount: 0,
      urgentCount: 0,
      warningCount: 0,
      shouldNotify: false,
      title: `${label} 菜鸟库存自动化`,
      markdown: `## ${label} 菜鸟库存自动化\n\n连接测试成功。此消息不包含任何业务数据。`,
      items: []
    };
    const result = await sendDingTalk({ report, secretStore: this.secrets, fetchImpl: this.fetchImpl });
    if (result.status === "sent") updateState(this.paths, { dingtalkTestAt: this.now().toISOString() });
    return result;
  }

  async runInventory(request: RunRequest = {}): Promise<RunResult> {
    const config = this.config();
    const mode = request.mode || "send";
    const queryDate = request.queryDate || dateInTimeZone(this.now(), config.businessTimeZone);
    if (!isIsoDate(queryDate)) throw new Error("queryDate 必须是 YYYY-MM-DD。");
    const unresolvedState = readJson<{ deliveryUnknownQueryDate?: string; deliveryUnknownRunId?: string }>(this.paths.state, {});
    if (mode === "send" && unresolvedState.deliveryUnknownQueryDate === queryDate) {
      const unresolvedRun = unresolvedState.deliveryUnknownRunId ? getRun(this.paths, unresolvedState.deliveryUnknownRunId) : null;
      if (unresolvedRun) return unresolvedRun;
      throw new DeliveryUnknownError("该查询日存在结果不确定的投递，已停止自动发送；请先使用明确的重试命令处理。");
    }
    const expectedSourceDate = previousSourceDate(queryDate);
    const runId = `${queryDate}-${this.now().toISOString().replace(/[-:.TZ]/g, "").slice(8, 20)}-${crypto.randomBytes(3).toString("hex")}`;
    const startedAt = this.now().toISOString();
    const releaseLock = acquireRunLock(this.paths.lock, runId);

    let sourceFile = request.inputFile || "";
    let sourceFileSha256 = "";
    let validation = emptyValidation(expectedSourceDate);
    let report: InventoryReport | null = null;
    let reportHash = "";
    let delivery: DeliveryResult = { status: "not_requested" };
    let callback: DeliveryResult = { status: "not_requested" };
    let status: RunResult["status"] = "running";
    let errorText = "";

    try {
      this.log(runId, `开始运行，查询日 ${queryDate}，模式 ${mode}`);
      if (!sourceFile) {
        const exported = await this.browserRunner({
          action: "export",
          queryDate,
          outputDir: this.paths.downloads,
          profileDir: this.paths.browserProfile,
          storageStateFile: this.paths.browserAuth,
          diagnosticsDir: this.paths.diagnostics
        });
        sourceFile = exported.file || "";
      }
      if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error("没有获得新的库存 Excel，已停止发送。");
      sourceFileSha256 = sha256(fs.readFileSync(sourceFile));
      const rawRows = await readInventoryWorkbook(sourceFile);
      const initialValidation = validateInventoryRows(rawRows, {
        file: sourceFile,
        expectedSourceDate,
        minRows: config.minRows,
        continuityOverlap: config.continuityOverlap
      });
      const previousRows = initialValidation.sourceDate
        ? this.snapshotRows(previousSourceDate(initialValidation.sourceDate))
        : [];
      validation = validateInventoryRows(rawRows, {
        file: sourceFile,
        expectedSourceDate,
        previousRows,
        minRows: config.minRows,
        continuityOverlap: config.continuityOverlap
      });
      if (!validation.ok) throw new Error(`库存校验失败：${validation.errors.join("；")}`);

      writeJsonAtomic(path.join(this.paths.snapshots, `${validation.sourceDate}.json`), {
        sourceDate: validation.sourceDate,
        queryDate,
        sourceFile: validation.file,
        sourceFileSha256,
        validatedAt: this.now().toISOString(),
        rows: validation.rows
      });
      report = buildInventoryReport({
        rows: validation.rows,
        thresholds: config.alertThresholds,
        maxRows: config.maxReportRows,
        acceptanceLabel: request.acceptanceLabel
      });
      reportHash = sha256(report.markdown);
      writeJsonAtomic(path.join(this.paths.reports, `${runId}.json`), report);
      fs.writeFileSync(path.join(this.paths.reports, `${runId}.md`), `${report.markdown}\n`, { mode: 0o600 });

      if (mode === "validate_only") {
        delivery = { status: "not_requested", reason: "validate_only" };
      } else {
        if (!config.reportPolicy) throw new Error("尚未选择日报发送策略。");
        if (config.reportPolicy === "critical_only" && !report.shouldNotify) {
          delivery = { status: "skipped", reason: "no_critical_alert" };
        } else {
          delivery = await this.deliverReport({ runId, report, reportHash, force: Boolean(request.forceSend), explicitRetry: false });
        }
      }

      if (mode === "validate_only") {
        callback = { status: "skipped", reason: "validate_only" };
      } else if (config.callback.enabled) {
        callback = await sendCallback({
          payload: publicRunPayload({ runId, queryDate, validation, report, delivery }),
          secretStore: this.secrets,
          fetchImpl: this.fetchImpl
        });
        if (callback.status === "unknown") throw new DeliveryUnknownError(`回调结果不确定：${callback.reason || callback.status}`);
        if (callback.status === "failed") throw new Error(`回调失败：${callback.reason || callback.status}`);
      } else callback = { status: "skipped", reason: "callback_disabled" };
      status = "succeeded";
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
      status = error instanceof DeliveryUnknownError ? "delivery_unknown" : "failed";
      if (error instanceof DeliveryUnknownError && delivery.status === "not_requested") delivery = { status: "unknown", reason: errorText };
      else if (delivery.status === "not_requested" && mode === "send") delivery = { status: "failed", reason: errorText };
      this.log(runId, errorText);
    } finally {
      releaseLock();
    }

    const result: RunResult = {
      runId,
      status,
      mode,
      queryDate,
      expectedSourceDate,
      sourceDate: validation.sourceDate,
      startedAt,
      completedAt: this.now().toISOString(),
      sourceFile: sourceFile ? path.basename(sourceFile) : "",
      sourceFileSha256,
      reportHash,
      rowCount: validation.rowCount,
      totalQuantity: validation.totalQuantity,
      validation,
      report,
      delivery,
      callback,
      ...(errorText ? { error: errorText } : {})
    };
    const compactResult = compactRunResult(result);
    saveRun(this.paths, compactResult);
    const statePatch: Record<string, unknown> = {};
    if (compactResult.delivery.status === "sent") statePatch.dingtalkTestAt = compactResult.completedAt;
    if (compactResult.status === "succeeded" && compactResult.mode === "validate_only" && !request.inputFile) {
      statePatch.dryRunValidatedAt = compactResult.completedAt;
      statePatch.dryRunRunId = compactResult.runId;
      statePatch.dryRunSource = "browser";
    }
    if (compactResult.status === "succeeded" && compactResult.mode === "send") {
      statePatch.lastSuccessfulSendQueryDate = compactResult.queryDate;
      statePatch.lastSuccessfulSendRunId = compactResult.runId;
      statePatch.deliveryUnknownQueryDate = null;
    }
    if (compactResult.status === "delivery_unknown") {
      statePatch.deliveryUnknownQueryDate = compactResult.queryDate;
      statePatch.deliveryUnknownRunId = compactResult.runId;
    }
    if (Object.keys(statePatch).length) updateState(this.paths, statePatch);
    this.applyRetention();
    return compactResult;
  }

  async retryDelivery(runId: string, force = false): Promise<RetryDeliveryResult> {
    const run = getRun(this.paths, runId);
    const report = readJson<InventoryReport | null>(path.join(this.paths.reports, `${runId}.json`), null);
    if (!run?.report || !report || !run.reportHash) throw new Error("指定运行没有可发送的已验真报告。");
    if (!run.validation.ok) throw new Error("不能发送未通过校验的报告。");
    let delivery = run.delivery;
    let callback = run.callback;
    let stage: "dingtalk" | "callback" = "dingtalk";
    try {
      if (["unknown", "failed", "not_requested"].includes(delivery.status)) {
        delivery = await this.deliverReport({ runId, report, reportHash: run.reportHash, force, explicitRetry: true });
      }
      stage = "callback";
      if (this.config().callback.enabled && ["unknown", "failed", "not_requested"].includes(callback.status)) {
        callback = await sendCallback({
          payload: publicRunPayload({ runId, queryDate: run.queryDate, validation: run.validation, report, delivery }),
          secretStore: this.secrets,
          fetchImpl: this.fetchImpl
        });
        if (callback.status === "unknown") throw new DeliveryUnknownError(`回调结果仍不确定：${callback.reason || callback.status}`);
        if (callback.status === "failed") throw new Error(`回调重试失败：${callback.reason || callback.status}`);
      } else if (!this.config().callback.enabled) callback = { status: "skipped", reason: "callback_disabled" };

      const { error: _error, ...withoutError } = run;
      const updated: RunResult = {
        ...withoutError,
        status: "succeeded",
        completedAt: this.now().toISOString(),
        delivery,
        callback
      };
      saveRun(this.paths, updated);
      updateState(this.paths, {
        lastSuccessfulSendQueryDate: run.queryDate,
        lastSuccessfulSendRunId: run.runId,
        deliveryUnknownQueryDate: null,
        deliveryUnknownRunId: null,
        ...(delivery.status === "sent" ? { dingtalkTestAt: updated.completedAt } : {})
      });
      return { runId, status: "succeeded", delivery, callback };
    } catch (error) {
      const unknown = error instanceof DeliveryUnknownError;
      const failedResult: DeliveryResult = { status: unknown ? "unknown" : "failed", reason: error instanceof Error ? error.message : String(error) };
      if (stage === "dingtalk") delivery = failedResult;
      else callback = failedResult;
      const retryStatus: "failed" | "delivery_unknown" = unknown ? "delivery_unknown" : "failed";
      const updated: RunResult = {
        ...run,
        status: retryStatus,
        completedAt: this.now().toISOString(),
        delivery,
        callback,
        error: failedResult.reason
      };
      saveRun(this.paths, updated);
      if (unknown) updateState(this.paths, { deliveryUnknownQueryDate: run.queryDate, deliveryUnknownRunId: run.runId });
      return { runId, status: retryStatus, delivery, callback };
    }
  }

  getRun(runId: string): RunResult | null { return getRun(this.paths, runId); }
  listRuns(limit = 20): RunResult[] { return listRuns(this.paths, limit); }

  async getStatus(): Promise<AutomationStatus> {
    const doctor = await this.doctor();
    const config = this.config();
    const active = readActiveLock(this.paths.lock);
    return {
      configured: Boolean(config.reportPolicy),
      ready: doctor.ready,
      lastRun: getLastRun(this.paths),
      schedule: { ...config.schedule, installed: scheduleInstalled() },
      activeRun: active ? { runId: active.runId, startedAt: active.startedAt } : null
    };
  }

  installSchedule(patch: Partial<ScheduleConfig> = {}): ScheduleConfig {
    const state = readJson<Record<string, unknown>>(this.paths.state, {});
    if (!runtimeReady(this.paths)) throw new Error("请先准备隔离运行环境。");
    if (!state.loggedInAt) throw new Error("请先验证菜鸟登录。");
    if (!this.config().reportPolicy) throw new Error("请先选择日报发送策略。");
    if (!state.dingtalkTestAt) throw new Error("请先完成钉钉测试。");
    if (!state.dryRunValidatedAt || state.dryRunSource !== "browser") throw new Error("请先完成真实抓取 dry-run。");
    return installSchedule(this.paths, patch);
  }

  removeSchedule(): void { removeSchedule(this.paths); }

  private snapshotRows(sourceDate: string): InventoryRow[] {
    return readJson<{ rows?: InventoryRow[] }>(path.join(this.paths.snapshots, `${sourceDate}.json`), {}).rows || [];
  }

  private async deliverReport(options: { runId: string; report: InventoryReport; reportHash: string; force: boolean; explicitRetry: boolean }): Promise<DeliveryResult> {
    const webhook = await this.secrets.get(SECRET_ACCOUNTS.dingtalkWebhook);
    if (!webhook) throw new Error("未配置钉钉 Webhook。");
    const fingerprint = sha256(webhook);
    const key = deliveryKey(options.report.sourceDate, options.reportHash, fingerprint);
    const previous = findSuccessfulDelivery(this.paths, key);
    if (previous && !options.force) {
      return { status: "skipped", reason: `already_sent:${previous.runId}`, destinationFingerprint: fingerprint };
    }
    const latest = findLatestDelivery(this.paths, key);
    if (latest?.result.status === "unknown" && !options.explicitRetry) {
      throw new DeliveryUnknownError(`报告 ${latest.runId} 的投递结果不确定，必须使用明确的重试命令。`);
    }
    try {
      const result = await sendDingTalk({ report: options.report, secretStore: this.secrets, fetchImpl: this.fetchImpl });
      recordDelivery(this.paths, {
        key,
        runId: options.runId,
        sourceDate: options.report.sourceDate,
        reportHash: options.reportHash,
        destinationFingerprint: fingerprint,
        result,
        createdAt: this.now().toISOString()
      });
      return result;
    } catch (error) {
      const result: DeliveryResult = error instanceof DeliveryUnknownError
        ? { status: "unknown", reason: error.message, destinationFingerprint: fingerprint }
        : { status: "failed", reason: error instanceof Error ? error.message : String(error), destinationFingerprint: fingerprint };
      recordDelivery(this.paths, {
        key,
        runId: options.runId,
        sourceDate: options.report.sourceDate,
        reportHash: options.reportHash,
        destinationFingerprint: fingerprint,
        result,
        createdAt: this.now().toISOString()
      });
      throw error;
    }
  }

  private applyRetention(): void {
    const retention = this.config().retention;
    removeOlderThan(this.paths.downloads, retention.rawDays, this.now().getTime());
    removeOlderThan(this.paths.logs, retention.logDays, this.now().getTime());
    removeOlderThan(this.paths.diagnostics, retention.diagnosticDays, this.now().getTime());
  }

  private log(runId: string, line: string): void {
    const safe = redactSensitive(line);
    fs.appendFileSync(path.join(this.paths.logs, `${runId}.log`), `[${this.now().toISOString()}] ${safe}\n`, { mode: 0o600 });
  }
}

export function redactSensitive(value: string): string {
  return value
    .replace(/((?:access_token|token|secret|password)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/("(?:access_token|token|secret|password)"\s*:\s*")[^"]+/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[REDACTED]");
}

export function createCainiaoAutomation(dependencies: AutomationDependencies = {}): CainiaoInventoryAutomation {
  return new CainiaoInventoryAutomation(dependencies);
}

function emptyValidation(expectedSourceDate: string): ValidationResult {
  return {
    ok: false,
    status: "invalid",
    file: "",
    sourceDate: "",
    expectedSourceDate,
    rowCount: 0,
    skuCount: 0,
    totalQuantity: 0,
    invalidFormulaCount: 0,
    invalidNumberCount: 0,
    duplicateCount: 0,
    overlapCount: 0,
    errors: [],
    warnings: [],
    rows: []
  };
}

function publicRunPayload(options: {
  runId: string;
  queryDate: string;
  validation: ValidationResult;
  report: InventoryReport;
  delivery: DeliveryResult;
}): unknown {
  return {
    event: "cainiao.inventory.validated",
    runId: options.runId,
    queryDate: options.queryDate,
    sourceDate: options.validation.sourceDate,
    rowCount: options.validation.rowCount,
    totalQuantity: options.validation.totalQuantity,
    validation: { ok: options.validation.ok, warnings: options.validation.warnings },
    report: {
      sourceDate: options.report.sourceDate,
      generatedAt: options.report.generatedAt,
      skuCount: options.report.skuCount,
      totalQuantity: options.report.totalQuantity,
      criticalCount: options.report.criticalCount,
      urgentCount: options.report.urgentCount,
      warningCount: options.report.warningCount,
      shouldNotify: options.report.shouldNotify,
      title: options.report.title,
      markdownStoredLocally: true
    },
    delivery: options.delivery
  };
}

function compactRunResult(result: RunResult): RunResult {
  return {
    ...result,
    validation: { ...result.validation, rows: [] },
    report: result.report ? { ...result.report, markdown: "", items: [] } : null
  };
}
