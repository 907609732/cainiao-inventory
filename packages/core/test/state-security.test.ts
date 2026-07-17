import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  acquireRunLock,
  createCainiaoAutomation,
  KeychainSecretStore,
  KEYCHAIN_SERVICE,
  loadConfig,
  redactSensitive
} from "../src/index.js";
import { tempDir } from "./helpers.js";

test("migrates a partial legacy config and rejects corrupt or future config", () => {
  const root = tempDir("cainiao-config");
  const automation = createCainiaoAutomation({ appRoot: root });
  fs.writeFileSync(automation.paths.config, JSON.stringify({ reportPolicy: "always", schedule: { hour: 21 } }));
  const migrated = loadConfig(automation.paths);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.schedule.hour, 21);
  assert.equal(migrated.schedule.checkIntervalSeconds, 900);
  assert.equal(JSON.parse(fs.readFileSync(automation.paths.config, "utf8")).schemaVersion, 1);

  fs.writeFileSync(automation.paths.config, "{broken");
  assert.throws(() => loadConfig(automation.paths), /配置文件损坏/);
  fs.writeFileSync(automation.paths.config, JSON.stringify({ schemaVersion: 2 }));
  assert.throws(() => loadConfig(automation.paths), /高于当前支持/);
});

test("run lock blocks concurrency and can be reacquired after release", () => {
  const lock = path.join(tempDir("cainiao-lock"), "run.lock");
  const release = acquireRunLock(lock, "run-one");
  assert.throws(() => acquireRunLock(lock, "run-two"), /run-one/);
  release();
  const releaseAgain = acquireRunLock(lock, "run-three");
  releaseAgain();
  assert.equal(fs.existsSync(lock), false);
});

test("run lock immediately recovers when the recorded process is gone", () => {
  const lock = path.join(tempDir("cainiao-dead-lock"), "run.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: 99999999, runId: "interrupted", startedAt: new Date().toISOString() }));
  const release = acquireRunLock(lock, "replacement");
  release();
  assert.equal(fs.existsSync(lock), false);
});

test("redacts tokens, secrets, passwords, and authorization values", () => {
  const input = "access_token=abc token=def secret=ghi password=jkl Authorization: Bearer bearer-value";
  const safe = redactSensitive(input);
  for (const secret of ["abc", "def", "ghi", "jkl", "bearer-value"]) assert.doesNotMatch(safe, new RegExp(secret));
  assert.match(safe, /\[REDACTED\]/);
});

test("Keychain store uses the fixed service and never embeds secrets in config", { skip: process.platform !== "darwin" }, async () => {
  const calls: string[][] = [];
  const store = new KeychainSecretStore(async (args) => {
    calls.push(args);
    return { stdout: args[0] === "find-generic-password" ? "stored-value\n" : "" };
  });
  await store.set("dingtalk-webhook", "secret-value");
  assert.equal(await store.get("dingtalk-webhook"), "stored-value");
  await store.remove("dingtalk-webhook");
  assert.ok(calls.every((args) => args.includes(KEYCHAIN_SERVICE)));
  assert.deepEqual(calls.map((args) => args[0]), ["add-generic-password", "find-generic-password", "delete-generic-password"]);
});

test("browser failures are logged without credential values", async () => {
  const root = tempDir("cainiao-log");
  const automation = createCainiaoAutomation({
    appRoot: root,
    browserRunner: async () => { throw new Error("access_token=private-token Authorization: Basic c2VjcmV0"); }
  });
  const result = await automation.runInventory({ mode: "validate_only", queryDate: "2026-07-17" });
  assert.equal(result.status, "failed");
  const log = fs.readFileSync(path.join(automation.paths.logs, `${result.runId}.log`), "utf8");
  assert.doesNotMatch(log, /private-token|c2VjcmV0/);
  assert.match(log, /\[REDACTED\]/);
});
