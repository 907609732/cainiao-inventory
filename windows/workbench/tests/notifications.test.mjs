import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNotificationSettings,
  validateNotifications,
  NOTIFICATION_SECRET_FIELDS,
} from "../desktop/shared/notification-settings.mjs";
import {
  sendNotificationReport,
  providerAccepted,
} from "../core/notifications.js";
const config = {
  dingtalkEnabled: false,
  feishuEnabled: true,
  feishuAppId: "demo",
  feishuReceiveId: "demo-chat",
  feishuReceiveIdType: "chat_id",
  wecomEnabled: true,
  emailEnabled: true,
  emailHost: "smtp.example.test",
  emailPort: 587,
  emailUser: "sender@example.test",
  emailTo: "receiver@example.test",
  telegramEnabled: true,
  telegramChatId: "-1001234567890",
};
const secrets = {
  feishuAppSecret: "fake-feishu",
  wecomKey: "fake-wecom",
  emailPassword: "fake-mail",
  telegramBotToken: "123:fake",
};
test("legacy DingTalk stays enabled; new channels default off and secrets are classified", () => {
  const n = normalizeNotificationSettings({});
  assert.equal(n.dingtalkEnabled, true);
  assert.equal(n.feishuEnabled, false);
  assert.equal(n.emailEnabled, false);
  assert.ok(NOTIFICATION_SECRET_FIELDS.includes("telegramBotToken"));
  assert.equal(
    validateNotifications(
      config,
      Object.fromEntries(Object.keys(secrets).map((k) => [k, true])),
    ).ok,
    true,
  );
  assert.equal(
    validateNotifications({ ...config, telegramChatId: "9007199254740993" }, {})
      .ok,
    false,
  );
});
test("fanout isolates failures, does not leak raw provider errors and marks partial delivery", async () => {
  const called = [];
  const providers = {
    feishu: async () => {
      called.push("feishu");
      return { data: { code: 0, data: { message_id: "demo-1" } } };
    },
    wecom: async () => {
      called.push("wecom");
      return { data: { errcode: 0 } };
    },
    email: async () => {
      called.push("email");
      return {
        data: {
          accepted: ["receiver@example.test"],
          rejected: [],
          messageId: "demo-mail",
        },
      };
    },
    telegram: async () => {
      called.push("telegram");
      throw Object.assign(
        Error("secret https://api.telegram.org/bot123:fake"),
        { code: "ETIMEDOUT" },
      );
    },
  };
  const result = await sendNotificationReport({
    title: "DEMO",
    text: "Synthetic inventory",
    settings: config,
    secrets,
    providers,
  });
  assert.deepEqual(called.sort(), ["email", "feishu", "telegram", "wecom"]);
  assert.equal(result.accepted, false);
  assert.equal(result.status, "partial");
  assert.equal(result.channels.telegram.status, "unknown");
  assert.doesNotMatch(
    JSON.stringify(result),
    /123:fake|receiver@|secret https/,
  );
});
test("configuration fails before sending; disabled channels are untouched", async () => {
  let calls = 0;
  await assert.rejects(
    sendNotificationReport({
      title: "demo",
      text: "demo",
      settings: {
        dingtalkEnabled: false,
        telegramEnabled: true,
        telegramChatId: "",
      },
      secrets,
      providers: {
        telegram: async () => {
          calls++;
        },
      },
    }),
  );
  assert.equal(calls, 0);
  const r = await sendNotificationReport({
    title: "demo",
    text: "demo",
    settings: { dingtalkEnabled: false, wecomEnabled: true },
    secrets,
    providers: {
      wecom: async () => {
        calls++;
        return { data: { errcode: 0 } };
      },
      telegram: async () => {
        throw Error("disabled");
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.accepted, true);
});
test("provider HTTP success cannot mask business rejection or partial mail rejection", () => {
  assert.equal(providerAccepted("feishu", { data: { code: 999 } }), false);
  assert.equal(providerAccepted("telegram", { data: { ok: false } }), false);
  assert.equal(
    providerAccepted("email", { data: { accepted: ["a"], rejected: ["b"] } }),
    false,
  );
  assert.equal(
    providerAccepted("email", {
      status: 500,
      data: { accepted: ["a"], rejected: [] },
    }),
    true,
  );
});

import { DatabaseSync } from "node:sqlite";
import { sendMonthlyNotifications } from "../core/monthly-notifications.js";
test("monthly retry only retries a failed channel and preserves accepted receipts", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE monthly_report_deliveries(report_type TEXT,report_month TEXT,status TEXT,attempted_at TEXT,sent_at TEXT,error_text TEXT,result_json TEXT,updated_at TEXT,PRIMARY KEY(report_type,report_month));",
  );
  let feishuCalls = 0,
    wecomCalls = 0;
  const settings = { ...config, emailEnabled: false, telegramEnabled: false };
  const providers = {
    feishu: async () => {
      feishuCalls++;
      return { data: { code: 0 } };
    },
    wecom: async () => {
      wecomCalls++;
      return { data: { errcode: wecomCalls === 1 ? 400 : 0 } };
    },
  };
  try {
    await assert.rejects(
      sendMonthlyNotifications({
        db,
        reportType: "monthly",
        month: "2026-08",
        report: { title: "demo", text: "synthetic" },
        settings,
        secrets,
        providers,
      }),
    );
    const result = await sendMonthlyNotifications({
      db,
      reportType: "monthly",
      month: "2026-08",
      report: { title: "demo", text: "synthetic" },
      settings,
      secrets,
      providers,
    });
    assert.equal(result.sent, true);
    assert.equal(feishuCalls, 1);
    assert.equal(wecomCalls, 2);
  } finally {
    db.close();
  }
});
import axios from "axios";
import { sdkProviders } from "../core/notifications.js";
test("real SDK adapter never logs credential-bearing HTTP rejection", async () => {
  const prior = axios.defaults.adapter,
    oldError = console.error;
  const logs = [];
  axios.defaults.adapter = async (c) => {
    throw Object.assign(Error("provider reject"), {
      response: { status: 400, data: { errcode: 400 }, config: c },
    });
  };
  console.error = (...args) => logs.push(args);
  try {
    const result = await sendNotificationReport({
      title: "demo",
      text: "synthetic",
      settings: { dingtalkEnabled: false, wecomEnabled: true },
      secrets: { wecomKey: "DEMO_KEY_MUST_NOT_LOG" },
    });
    assert.equal(result.accepted, false);
    assert.equal(logs.length, 0);
  } finally {
    axios.defaults.adapter = prior;
    console.error = oldError;
  }
});
test("monthly invalid configuration never claims any deliveries", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE monthly_report_deliveries(report_type TEXT,report_month TEXT,status TEXT,attempted_at TEXT,sent_at TEXT,error_text TEXT,result_json TEXT,updated_at TEXT,PRIMARY KEY(report_type,report_month))",
  );
  try {
    await assert.rejects(
      sendMonthlyNotifications({
        db,
        reportType: "monthly",
        month: "2026-08",
        report: { title: "demo", text: "synthetic" },
        settings: { dingtalkEnabled: false, wecomEnabled: true },
        secrets: {},
      }),
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM monthly_report_deliveries").get().n,
      0,
    );
  } finally {
    db.close();
  }
});
test("real SDK preserves Unicode while splitting WeCom and Telegram limits", async () => {
  const prior = axios.defaults.adapter,
    requests = [];
  axios.defaults.adapter = async (c) => {
    const data = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
    requests.push({ url: c.url, data });
    return {
      status: 200,
      statusText: "OK",
      headers: {},
      data: c.url.includes("telegram")
        ? { ok: true, result: { message_id: 1 } }
        : { errcode: 0 },
    };
  };
  try {
    const r = await sendNotificationReport({
      title: "演示",
      text: "货品🧪".repeat(1800),
      settings: {
        dingtalkEnabled: false,
        wecomEnabled: true,
        telegramEnabled: true,
        telegramChatId: "-1001234567890",
      },
      secrets,
    });
    assert.equal(r.accepted, true);
    const wx = requests.filter((x) => x.url.includes("weixin"));
    assert.ok(wx.length > 1);
    for (const p of wx)
      assert.ok(Buffer.byteLength(p.data.text.content, "utf8") <= 2048);
    for (const p of requests.filter((x) => x.url.includes("telegram"))) {
      assert.ok(p.data.text.length <= 4096);
      assert.equal(p.data.chat_id, -1001234567890);
      assert.doesNotMatch(p.data.text, /\uFFFD/);
    }
  } finally {
    axios.defaults.adapter = prior;
  }
});
test("monthly unknown outcomes remain blocked from automatic retries", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE monthly_report_deliveries(report_type TEXT,report_month TEXT,status TEXT,attempted_at TEXT,sent_at TEXT,error_text TEXT,result_json TEXT,updated_at TEXT,PRIMARY KEY(report_type,report_month))",
  );
  let calls = 0;
  const args = {
    db,
    reportType: "monthly",
    month: "2026-08",
    report: { title: "demo", text: "synthetic" },
    settings: { dingtalkEnabled: false, wecomEnabled: true },
    secrets,
    providers: {
      wecom: async () => {
        calls++;
        throw Object.assign(Error("timeout"), { code: "ETIMEDOUT" });
      },
    },
  };
  try {
    await assert.rejects(sendMonthlyNotifications(args));
    await assert.rejects(sendMonthlyNotifications(args));
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});
test("unrecognized provider receipts remain unknown and are never retried automatically", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE monthly_report_deliveries(report_type TEXT,report_month TEXT,status TEXT,attempted_at TEXT,sent_at TEXT,error_text TEXT,result_json TEXT,updated_at TEXT,PRIMARY KEY(report_type,report_month))",
  );
  let calls = 0;
  const args = {
    db,
    reportType: "monthly",
    month: "2026-08",
    report: { title: "demo", text: "synthetic" },
    settings: { dingtalkEnabled: false, wecomEnabled: true },
    secrets,
    providers: {
      wecom: async () => {
        calls++;
        return { status: 200, data: {} };
      },
    },
  };
  try {
    await assert.rejects(sendMonthlyNotifications(args));
    await assert.rejects(sendMonthlyNotifications(args));
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});
test("legacy DingTalk webhook retains targeted mention message", async () => {
  const prior = axios.defaults.adapter,
    payloads = [];
  axios.defaults.adapter = async (c) => {
    payloads.push(JSON.parse(c.data));
    return { status: 200, data: { errcode: 0 }, headers: {} };
  };
  try {
    const result = await sendNotificationReport({
      title: "DEMO",
      text: "Synthetic",
      settings: {
        deliveryMode: "webhook",
        dingtalkTargetUserId: "demo-user",
        dingtalkTargetName: "演示接收人",
      },
      secrets: {
        dingtalkWebhook:
          "https://oapi.dingtalk.com/robot/send?access_token=DEMO_ONLY",
      },
    });
    assert.equal(result.accepted, true);
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[1].at.atUserIds, ["demo-user"]);
  } finally {
    axios.defaults.adapter = prior;
  }
});
import nodemailer from "nodemailer";
test("SMTP uses Nodemailer and requires encrypted transport on both supported port styles", async () => {
  const original = nodemailer.createTransport,
    options = [];
  let closes = 0;
  nodemailer.createTransport = (option) => {
    options.push(option);
    return {
      sendMail: async () => ({
        accepted: ["demo@example.test"],
        rejected: [],
        messageId: "demo-mail-id",
      }),
      close: () => {
        closes++;
      },
    };
  };
  try {
    for (const port of [465, 587]) {
      const result = await sendNotificationReport({
        title: "demo",
        text: "synthetic",
        settings: {
          ...config,
          dingtalkEnabled: false,
          feishuEnabled: false,
          wecomEnabled: false,
          telegramEnabled: false,
          emailPort: port,
        },
        secrets,
      });
      assert.equal(result.accepted, true);
    }
    assert.equal(options[0].secure, true);
    assert.equal(options[1].secure, false);
    assert.equal(options[1].requireTLS, true);
    assert.equal(options[1].tls.minVersion, "TLSv1.2");
    assert.equal(closes, 2);
  } finally {
    nodemailer.createTransport = original;
  }
});
test("SMTP authentication failure can retry after credentials are corrected", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE monthly_report_deliveries(report_type TEXT,report_month TEXT,status TEXT,attempted_at TEXT,sent_at TEXT,error_text TEXT,result_json TEXT,updated_at TEXT,PRIMARY KEY(report_type,report_month))",
  );
  let calls = 0;
  const args = {
    db,
    reportType: "monthly",
    month: "2026-08",
    report: { title: "demo", text: "synthetic" },
    settings: {
      ...config,
      feishuEnabled: false,
      wecomEnabled: false,
      telegramEnabled: false,
    },
    secrets,
    providers: {
      email: async () => {
        if (++calls === 1)
          throw Object.assign(Error("auth rejected"), {
            code: "EAUTH",
            command: "AUTH PLAIN",
          });
        return { data: { accepted: ["demo@example.test"], rejected: [] } };
      },
    },
  };
  try {
    await assert.rejects(sendMonthlyNotifications(args));
    const result = await sendMonthlyNotifications(args);
    assert.equal(result.sent, true);
    assert.equal(calls, 2);
  } finally {
    db.close();
  }
});
test("real Feishu SDK obtains token and sends to configured target without returning credentials", async () => {
  const prior = axios.defaults.adapter,
    requests = [];
  axios.defaults.adapter = async (c) => {
    requests.push(c);
    return {
      status: 200,
      headers: {},
      data: c.url.includes("/auth/")
        ? { code: 0, tenant_access_token: "DEMO_ACCESS_TOKEN", expire: 7200 }
        : { code: 0, data: { message_id: "demo-feishu-message" } },
    };
  };
  try {
    const result = await sendNotificationReport({
      title: "DEMO",
      text: "Synthetic",
      settings: {
        ...config,
        wecomEnabled: false,
        emailEnabled: false,
        telegramEnabled: false,
      },
      secrets,
    });
    assert.equal(result.accepted, true);
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].data).receive_id, "demo-chat");
    assert.equal(result.channels.feishu.receiptId, "demo-feishu-message");
    assert.doesNotMatch(
      JSON.stringify(result),
      /DEMO_ACCESS_TOKEN|fake-feishu/,
    );
  } finally {
    axios.defaults.adapter = prior;
  }
});
