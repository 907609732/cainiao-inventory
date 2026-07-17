import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryUnknownError, MemorySecretStore, SECRET_ACCOUNTS, sendDingTalk, signedDingTalkUrl } from "../src/index.js";
import { okDingTalkResponse } from "./helpers.js";

const report = {
  sourceDate: "2026-07-16",
  generatedAt: "2026-07-17T14:00:00.000Z",
  skuCount: 0,
  totalQuantity: 0,
  criticalCount: 0,
  urgentCount: 0,
  warningCount: 0,
  shouldNotify: false,
  title: "测试",
  markdown: "## 测试",
  items: []
};

test("signs DingTalk webhook without exposing the secret", () => {
  const value = signedDingTalkUrl("https://example.test/send?access_token=token", "secret", 1234);
  assert.match(value, /timestamp=1234/);
  assert.match(value, /sign=/);
  assert.doesNotMatch(value, /secret/);
});

test("sends a successful DingTalk payload", async () => {
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  let calls = 0;
  const result = await sendDingTalk({
    report,
    secretStore: secrets,
    fetchImpl: async () => { calls += 1; return okDingTalkResponse(); }
  });
  assert.equal(result.status, "sent");
  assert.equal(calls, 1);
});

test("marks a network timeout as delivery unknown", async () => {
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  await assert.rejects(() => sendDingTalk({
    report,
    secretStore: secrets,
    fetchImpl: async () => { throw new Error("socket closed"); }
}), DeliveryUnknownError);
});

test("retries a transient 5xx response and then succeeds", async () => {
  const secrets = new MemorySecretStore();
  await secrets.set(SECRET_ACCOUNTS.dingtalkWebhook, "https://example.test/send?access_token=token");
  let calls = 0;
  const result = await sendDingTalk({
    report,
    secretStore: secrets,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response("temporary", { status: 503 }) : okDingTalkResponse();
    }
  });
  assert.equal(result.status, "sent");
  assert.equal(calls, 2);
});
