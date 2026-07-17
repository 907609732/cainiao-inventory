import crypto from "node:crypto";
import type { DeliveryResult, InventoryReport, SecretStore } from "./types.js";

export const SECRET_ACCOUNTS = {
  dingtalkWebhook: "dingtalk-webhook",
  dingtalkSecret: "dingtalk-secret",
  callbackUrl: "callback-url",
  callbackToken: "callback-token"
} as const;

export class DeliveryUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryUnknownError";
  }
}

export async function sendDingTalk(options: {
  report: InventoryReport;
  secretStore: SecretStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DeliveryResult> {
  const webhook = await options.secretStore.get(SECRET_ACCOUNTS.dingtalkWebhook);
  if (!webhook) throw new Error("未配置钉钉 Webhook。");
  const secret = await options.secretStore.get(SECRET_ACCOUNTS.dingtalkSecret);
  const target = signedDingTalkUrl(webhook, secret);
  const destinationFingerprint = sha256(webhook);
  const payload = {
    msgtype: "markdown",
    markdown: { title: options.report.title, text: options.report.markdown },
    at: { atUserIds: [], atMobiles: [], isAtAll: false }
  };
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(fetchImpl, target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }, timeoutMs);
    } catch (error) {
      throw new DeliveryUnknownError(`钉钉请求结果不确定：${message(error)}`);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await delay(500 * 2 ** attempt);
      continue;
    }
    const body = await safeJson(response);
    if (!response.ok) throw new Error(`钉钉 HTTP ${response.status}：${JSON.stringify(body)}`);
    if (Number(body?.errcode) !== 0) throw new Error(`钉钉返回失败：${JSON.stringify(body)}`);
    return {
      status: "sent",
      responseCode: response.status,
      destinationFingerprint,
      deliveredAt: new Date().toISOString()
    };
  }
  throw new Error("钉钉发送重试耗尽。");
}

export async function sendCallback(options: {
  payload: unknown;
  secretStore: SecretStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DeliveryResult> {
  const url = await options.secretStore.get(SECRET_ACCOUNTS.callbackUrl);
  if (!url) return { status: "skipped", reason: "callback_not_configured" };
  const token = await options.secretStore.get(SECRET_ACCOUNTS.callbackToken);
  const body = JSON.stringify(options.payload);
  const signature = token ? crypto.createHmac("sha256", token).update(body).digest("hex") : "";
  let response: Response;
  try {
    response = await fetchWithTimeout(options.fetchImpl || fetch, url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-cainiao-signature": `sha256=${signature}` } : {})
      },
      body
    }, options.timeoutMs ?? 15_000);
  } catch (error) {
    return { status: "unknown", reason: `callback_unknown:${message(error)}` };
  }
  if (!response.ok) return { status: "failed", responseCode: response.status, reason: `callback_http_${response.status}` };
  return {
    status: "sent",
    responseCode: response.status,
    destinationFingerprint: sha256(url),
    deliveredAt: new Date().toISOString()
  };
}

export function signedDingTalkUrl(webhook: string, secret: string, now = Date.now()): string {
  if (!secret) return webhook;
  const timestamp = String(now);
  const sign = crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  const url = new URL(webhook);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return { text: await response.text().catch(() => "") };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
