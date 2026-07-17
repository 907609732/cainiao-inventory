import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCainiaoAutomation, MemorySecretStore, SECRET_ACCOUNTS } from "../src/index.js";
import { inventoryRows, okDingTalkResponse, tempDir, writeInventoryWorkbook } from "./helpers.js";

test("sends one validated report and skips the duplicate", async () => {
  const root = tempDir("cainiao-automation");
  const file = path.join(root, "inventory.xlsx");
  await writeInventoryWorkbook(file);
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  let calls = 0;
  const automation = createCainiaoAutomation({
    appRoot: root,
    secretStore: secrets,
    now: () => new Date("2026-07-17T14:05:00Z"),
    fetch: async () => { calls += 1; return okDingTalkResponse(); }
  });
  automation.configure({ reportPolicy: "always" });
  const first = await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  const second = await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  assert.equal(first.status, "succeeded");
  assert.equal(first.delivery.status, "sent");
  assert.equal(second.status, "succeeded");
  assert.equal(second.delivery.status, "skipped");
  assert.match(second.delivery.reason || "", /already_sent/);
  assert.equal(calls, 1);
});

test("validation failure blocks every external request", async () => {
  const root = tempDir("cainiao-invalid");
  const file = path.join(root, "invalid.xlsx");
  const rows = inventoryRows("2026-07-15", 10);
  rows[0]!["期末库存"] = 999;
  await writeInventoryWorkbook(file, rows);
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  let calls = 0;
  const automation = createCainiaoAutomation({
    appRoot: root,
    secretStore: secrets,
    now: () => new Date("2026-07-17T14:05:00Z"),
    fetch: async () => { calls += 1; return okDingTalkResponse(); }
  });
  automation.configure({ reportPolicy: "always", callback: { enabled: true } });
  const result = await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  assert.equal(result.status, "failed");
  assert.equal(result.validation.ok, false);
  assert.equal(calls, 0);
});

test("validate-only never sends DingTalk or callback traffic", async () => {
  const root = tempDir("cainiao-dry-run");
  const file = path.join(root, "inventory.xlsx");
  await writeInventoryWorkbook(file);
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  await secrets.set(SECRET_ACCOUNTS.callbackUrl, "https://callback.test/inventory");
  let calls = 0;
  const automation = createCainiaoAutomation({ appRoot: root, secretStore: secrets, fetch: async () => { calls += 1; return okDingTalkResponse(); } });
  automation.configure({ reportPolicy: "always", callback: { enabled: true } });
  const result = await automation.runInventory({ mode: "validate_only", queryDate: "2026-07-17", inputFile: file });
  assert.equal(result.status, "succeeded");
  assert.equal(result.delivery.reason, "validate_only");
  assert.equal(result.callback.reason, "validate_only");
  assert.equal(result.validation.rows.length, 0);
  assert.equal(result.report?.items.length, 0);
  assert.equal(result.report?.markdown, "");
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "snapshots", "2026-07-16.json"), "utf8")) as { rows: unknown[] };
  assert.equal(snapshot.rows.length, 10);
  const storedReport = JSON.parse(fs.readFileSync(path.join(root, "reports", `${result.runId}.json`), "utf8")) as { markdown: string; items: unknown[] };
  assert.match(storedReport.markdown, /菜鸟库存日报/);
  assert.equal(storedReport.items.length, 10);
  assert.equal(calls, 0);
});

test("an ambiguous DingTalk connection becomes delivery_unknown", async () => {
  const root = tempDir("cainiao-unknown");
  const file = path.join(root, "inventory.xlsx");
  await writeInventoryWorkbook(file);
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  let calls = 0;
  let recover = false;
  const automation = createCainiaoAutomation({
    appRoot: root,
    secretStore: secrets,
    fetch: async () => {
      calls += 1;
      if (!recover) throw new Error("connection reset");
      return okDingTalkResponse();
    }
  });
  automation.configure({ reportPolicy: "always" });
  const result = await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  assert.equal(result.status, "delivery_unknown");
  assert.equal(result.delivery.status, "unknown");
  const blocked = await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  assert.equal(blocked.runId, result.runId);
  assert.equal(calls, 1);
  recover = true;
  const retry = await automation.retryDelivery(result.runId);
  assert.equal(retry.status, "succeeded");
  assert.equal(retry.delivery.status, "sent");
  assert.equal(calls, 2);
});

test("critical-only policy skips DingTalk when no SKU is below seven days", async () => {
  const root = tempDir("cainiao-policy");
  const file = path.join(root, "inventory.xlsx");
  const rows = inventoryRows("2026-07-16", 10);
  for (const row of rows) row["近30天销量"] = 0;
  await writeInventoryWorkbook(file, rows);
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  let calls = 0;
  const automation = createCainiaoAutomation({ appRoot: root, secretStore: secrets, fetch: async () => { calls += 1; return okDingTalkResponse(); } });
  automation.configure({ reportPolicy: "critical_only" });
  const result = await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  assert.equal(result.status, "succeeded");
  assert.equal(result.delivery.reason, "no_critical_alert");
  assert.equal(calls, 0);
});
