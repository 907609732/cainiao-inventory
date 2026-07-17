import fs from "node:fs";
import { readJson, writeJsonAtomic } from "./files.js";

interface LockRecord { pid: number; runId: string; startedAt: string }

export function acquireRunLock(file: string, runId: string, staleMs = 2 * 60 * 60 * 1000): () => void {
  try {
    const handle = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(handle, `${JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() })}\n`);
    fs.closeSync(handle);
  } catch (error) {
    const existing = readJson<LockRecord | null>(file, null);
    const started = existing ? Date.parse(existing.startedAt) : Number.NaN;
    const processIsDead = existing ? !isProcessAlive(existing.pid) : false;
    const malformedAndStale = !existing && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs > staleMs;
    if (processIsDead || malformedAndStale || (Number.isFinite(started) && Date.now() - started > staleMs && processIsDead)) {
      fs.rmSync(file, { force: true });
      return acquireRunLock(file, runId, staleMs);
    }
    throw new Error(`已有库存任务正在运行${existing?.runId ? `：${existing.runId}` : ""}。`);
  }
  return () => fs.rmSync(file, { force: true });
}

export function readActiveLock(file: string): LockRecord | null {
  const lock = readJson<LockRecord | null>(file, null);
  if (!lock) return null;
  if (!isProcessAlive(lock.pid)) {
    try { fs.rmSync(file, { force: true }); } catch {}
    return null;
  }
  return lock;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
