import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretStore } from "./types.js";

const execFileAsync = promisify(execFile);
export const KEYCHAIN_SERVICE = "cainiao-inventory-codex";
export type SecurityRunner = (args: string[]) => Promise<{ stdout: string }>;

const runSecurity: SecurityRunner = async (args) => {
  const { stdout } = await execFileAsync("/usr/bin/security", args, { encoding: "utf8" });
  return { stdout: String(stdout) };
};

export class KeychainSecretStore implements SecretStore {
  constructor(private readonly runner: SecurityRunner = runSecurity) {}

  async get(account: string): Promise<string> {
    if (process.platform !== "darwin") return "";
    try {
      const { stdout } = await this.runner([
        "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"
      ]);
      return stdout.trim();
    } catch {
      return "";
    }
  }

  async set(account: string, value: string): Promise<void> {
    if (process.platform !== "darwin") throw new Error("当前系统不支持 macOS Keychain。");
    if (!value) {
      await this.remove(account);
      return;
    }
    await this.runner([
      "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", value
    ]);
  }

  async remove(account: string): Promise<void> {
    if (process.platform !== "darwin") return;
    try {
      await this.runner(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]);
    } catch {
      // Removing a missing secret is idempotent.
    }
  }
}

export class MemorySecretStore implements SecretStore {
  private values = new Map<string, string>();
  async get(account: string): Promise<string> { return this.values.get(account) || ""; }
  async set(account: string, value: string): Promise<void> { this.values.set(account, value); }
  async remove(account: string): Promise<void> { this.values.delete(account); }
}
