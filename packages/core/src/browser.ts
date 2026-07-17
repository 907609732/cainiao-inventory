import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readJson } from "./files.js";
import type { AppPaths } from "./paths.js";
import type { BrowserWorkerRequest, BrowserWorkerResult } from "./types.js";

interface RuntimeMetadata {
  nodePath: string;
  workerPath: string;
  browsersPath: string;
  cliPath?: string;
  installedAt: string;
}

export function runtimeMetadata(paths: AppPaths): RuntimeMetadata | null {
  return readJson<RuntimeMetadata | null>(path.join(paths.runtime, "runtime.json"), null);
}

export function runtimeReady(paths: AppPaths): boolean {
  const metadata = runtimeMetadata(paths);
  return Boolean(
    metadata &&
    fs.existsSync(metadata.nodePath) &&
    fs.existsSync(metadata.workerPath) &&
    fs.existsSync(metadata.browsersPath)
  );
}

export async function runBrowserWorker(paths: AppPaths, request: Omit<BrowserWorkerRequest, "profileDir" | "storageStateFile" | "diagnosticsDir">): Promise<BrowserWorkerResult> {
  const metadata = runtimeMetadata(paths);
  if (!metadata || !runtimeReady(paths)) throw new Error("浏览器运行时尚未准备，请先在设置向导执行“准备运行环境”。");
  return new Promise((resolve, reject) => {
    const child = spawn(metadata.nodePath, [metadata.workerPath], {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: metadata.browsersPath,
        CAINIAO_BROWSER_REQUEST: JSON.stringify({
          ...request,
          profileDir: paths.browserProfile,
          storageStateFile: paths.browserAuth,
          diagnosticsDir: paths.diagnostics
        })
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const hardTimeoutMs = request.action === "login" ? 11 * 60_000 : 210_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, hardTimeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`浏览器任务超过 ${Math.round(hardTimeoutMs / 1000)} 秒硬上限：${redact(stderr) || "未返回阶段"}`));
        return;
      }
      const lastLine = stdout.trim().split("\n").filter(Boolean).at(-1) || "";
      try {
        const result = JSON.parse(lastLine) as BrowserWorkerResult;
        if (code === 0 && result.ok) resolve(result);
        else reject(new Error(result.message || redact(stderr) || `浏览器进程退出：${code}`));
      } catch {
        reject(new Error(redact(stderr) || redact(stdout) || `浏览器进程没有返回有效结果：${code}`));
      }
    });
  });
}

function redact(value: string): string {
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]")
    .replace(/password=[^&\s]+/gi, "password=[REDACTED]")
    .trim();
}
