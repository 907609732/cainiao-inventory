import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createCainiaoAutomation, dateInTimeZone, dueQueryDate, MemorySecretStore, previousSourceDate, SECRET_ACCOUNTS } from "../src/index.js";
import { okDingTalkResponse, tempDir, writeInventoryWorkbook } from "./helpers.js";

test("calculates China business date independently from the Mac time zone", () => {
  assert.equal(dateInTimeZone(new Date("2026-07-17T15:59:00Z"), "Asia/Shanghai"), "2026-07-17");
  assert.equal(dateInTimeZone(new Date("2026-07-17T16:01:00Z"), "Asia/Shanghai"), "2026-07-18");
  assert.equal(previousSourceDate("2026-03-01"), "2026-02-28");
});

test("schedules at 22:00 China time and catches up for 24 hours", () => {
  const automation = createCainiaoAutomation({ appRoot: tempDir("cainiao-schedule") });
  automation.configure({ schedule: { ...automation.config().schedule, enabled: true } });
  assert.deepEqual(dueQueryDate(automation.paths, new Date("2026-07-17T14:00:00Z")), {
    due: true,
    queryDate: "2026-07-17",
    reason: "on_time"
  });
  assert.equal(dueQueryDate(automation.paths, new Date("2026-07-18T13:30:00Z")).due, true);
  assert.equal(dueQueryDate(automation.paths, new Date("2026-07-18T13:59:00Z")).queryDate, "2026-07-17");
  assert.equal(dueQueryDate(automation.paths, new Date("2026-07-18T14:01:00Z")).queryDate, "2026-07-18");
});

test("a dry-run does not suppress the scheduled send, while a completed send does", async () => {
  const root = tempDir("cainiao-schedule-state");
  const file = path.join(root, "inventory.xlsx");
  await writeInventoryWorkbook(file);
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  const automation = createCainiaoAutomation({ appRoot: root, secretStore: secrets, fetch: async () => okDingTalkResponse() });
  automation.configure({ reportPolicy: "always", schedule: { ...automation.config().schedule, enabled: true } });
  await automation.runInventory({ mode: "validate_only", queryDate: "2026-07-17", inputFile: file });
  assert.equal(dueQueryDate(automation.paths, new Date("2026-07-17T14:05:00Z")).due, true);
  await automation.runInventory({ mode: "send", queryDate: "2026-07-17", inputFile: file });
  assert.deepEqual(dueQueryDate(automation.paths, new Date("2026-07-17T14:10:00Z")), {
    due: false,
    queryDate: "2026-07-17",
    reason: "already_succeeded"
  });
});
