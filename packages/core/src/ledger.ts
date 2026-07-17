import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./files.js";
import type { DeliveryResult, RunResult } from "./types.js";
import type { AppPaths } from "./paths.js";

interface DeliveryRecord {
  key: string;
  runId: string;
  sourceDate: string;
  reportHash: string;
  destinationFingerprint: string;
  result: DeliveryResult;
  createdAt: string;
}

interface DeliveryLedger {
  version: 1;
  records: DeliveryRecord[];
}

export function deliveryKey(sourceDate: string, reportHash: string, destinationFingerprint: string): string {
  return `${sourceDate}:${reportHash}:${destinationFingerprint}`;
}

export function findSuccessfulDelivery(paths: AppPaths, key: string): DeliveryRecord | null {
  const ledger = readJson<DeliveryLedger>(paths.deliveries, { version: 1, records: [] });
  return ledger.records.find((record) => record.key === key && record.result.status === "sent") || null;
}

export function findLatestDelivery(paths: AppPaths, key: string): DeliveryRecord | null {
  const ledger = readJson<DeliveryLedger>(paths.deliveries, { version: 1, records: [] });
  return [...ledger.records].reverse().find((record) => record.key === key) || null;
}

export function recordDelivery(paths: AppPaths, record: DeliveryRecord): void {
  const ledger = readJson<DeliveryLedger>(paths.deliveries, { version: 1, records: [] });
  const filtered = ledger.records.filter((item) => item.key !== record.key || item.runId !== record.runId);
  filtered.push(record);
  writeJsonAtomic(paths.deliveries, { version: 1, records: filtered.slice(-1000) });
}

export function saveRun(paths: AppPaths, run: RunResult): void {
  writeJsonAtomic(path.join(paths.runs, `${run.runId}.json`), run);
  updateState(paths, {
    lastRunId: run.runId,
    lastStatus: run.status,
    lastSourceDate: run.sourceDate,
    lastQueryDate: run.queryDate,
    updatedAt: run.completedAt
  });
}

export function updateState(paths: AppPaths, patch: Record<string, unknown>): void {
  const current = readJson<Record<string, unknown>>(paths.state, {});
  writeJsonAtomic(paths.state, { ...current, ...patch });
}

export function getRun(paths: AppPaths, runId: string): RunResult | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(runId)) return null;
  return readJson<RunResult | null>(path.join(paths.runs, `${runId}.json`), null);
}

export function getLastRun(paths: AppPaths): RunResult | null {
  const state = readJson<{ lastRunId?: string }>(paths.state, {});
  return state.lastRunId ? getRun(paths, state.lastRunId) : null;
}

export function listRuns(paths: AppPaths, limit = 20): RunResult[] {
  if (!fs.existsSync(paths.runs)) return [];
  return fs.readdirSync(paths.runs)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(paths.runs, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ name }) => readJson<RunResult | null>(path.join(paths.runs, name), null))
    .filter((run): run is RunResult => Boolean(run));
}
