import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function ensurePrivateFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // The file may not exist yet.
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  ensurePrivateFile(file);
}

export function removeOlderThan(dir: string, days: number, now = Date.now()): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs < cutoff) fs.rmSync(file, { recursive: entry.isDirectory(), force: true });
    } catch {
      // Retention is best effort and must never fail a validated run.
    }
  }
}
