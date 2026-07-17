import os from "node:os";
import path from "node:path";

export interface AppPaths {
  root: string;
  config: string;
  runtime: string;
  browserProfile: string;
  browserAuth: string;
  browsers: string;
  downloads: string;
  snapshots: string;
  runs: string;
  reports: string;
  logs: string;
  diagnostics: string;
  state: string;
  deliveries: string;
  lock: string;
}

export function resolveAppPaths(rootOverride?: string): AppPaths {
  const root = rootOverride || path.join(os.homedir(), "Library", "Application Support", "Cainiao Inventory Codex");
  return {
    root,
    config: path.join(root, "config.json"),
    runtime: path.join(root, "runtime"),
    browserProfile: path.join(root, "browser-profile"),
    browserAuth: path.join(root, "browser-auth.json"),
    browsers: path.join(root, "browsers"),
    downloads: path.join(root, "downloads"),
    snapshots: path.join(root, "snapshots"),
    runs: path.join(root, "runs"),
    reports: path.join(root, "reports"),
    logs: path.join(root, "logs"),
    diagnostics: path.join(root, "diagnostics"),
    state: path.join(root, "state.json"),
    deliveries: path.join(root, "deliveries.json"),
    lock: path.join(root, "run.lock")
  };
}
