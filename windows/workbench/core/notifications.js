import axios from "axios";
import { AsyncLocalStorage } from "node:async_hooks";
const sdkRequestScope = new AsyncLocalStorage();
// Upstream logs raw Axios responses on HTTP errors. Convert only SDK-scoped
// HTTP errors into normal responses before that logger sees request secrets.
axios.interceptors.response.use(undefined, (error) => {
  if (sdkRequestScope.getStore() && error.response)
    return {
      status: error.response.status,
      statusText: error.response.statusText || "",
      data: error.response.data,
      headers: {},
    };
  return Promise.reject(error);
});
import {
  normalizeNotificationSettings,
  enabledNotificationChannels,
  validateNotifications,
} from "../desktop/shared/notification-settings.mjs";
import { sendDingTalkAppRobotMessage } from "./dingtalk-app-robot.js";
import {
  sendDingTalkWebhookMarkdown,
  sendDingTalkWebhookText,
  buildInventoryMentionText,
} from "./dingtalk.js";
import nodemailer from "nodemailer";
export function notificationEnvironment() {
  return {
    settings: JSON.parse(process.env.WAREHOUSE_NOTIFICATION_CONFIG || "{}"),
    secrets: JSON.parse(process.env.WAREHOUSE_NOTIFICATION_SECRETS || "{}"),
  };
}
export function providerAccepted(id, result) {
  if (!result || result.skipped) return false;
  if (id === "dingtalk" && result.report)
    return (
      result.report.errcode === 0 &&
      (!result.mention || result.mention.errcode === 0)
    );
  if (id === "dingtalk")
    return Boolean(result?.processQueryKey || result?.errcode === 0);
  const d = result?.data;
  if (id === "feishu") return d?.code === 0;
  if (id === "wecom") return d?.errcode === 0;
  if (id === "telegram") return d?.ok === true && Boolean(d.result?.message_id);
  if (id === "email")
    return (
      Array.isArray(d?.accepted) && d.accepted.length > 0 && !d.rejected?.length
    );
  return false;
}
export async function sdkProviders(settings, secrets) {
  const sdk = await import("push-all-in-one");
  const { default: debug } = await import("debug");
  debug.disable();
  const s = normalizeNotificationSettings(settings);
  const chunks = (text, max, bytes = false) => {
    const out = [];
    let part = "",
      size = 0;
    for (const char of text) {
      const n = bytes ? Buffer.byteLength(char, "utf8") : char.length;
      if (size + n > max) {
        out.push(part);
        part = "";
        size = 0;
      }
      part += char;
      size += n;
    }
    if (part || !out.length) out.push(part);
    return out;
  };
  const sendChunks = async (id, text, max, bytes, send) => {
    let sent = 0,
      result;
    for (const part of chunks(text, max, bytes)) {
      try {
        result = await send(part);
        if (!providerAccepted(id, result)) {
          if (sent)
            throw Object.assign(Error("部分消息已受理"), {
              code: "PARTIAL_DELIVERY",
            });
          return result;
        }
        sent++;
      } catch (error) {
        if (sent)
          throw Object.assign(Error("部分消息已受理，后续结果未完成"), {
            code: "PARTIAL_DELIVERY",
          });
        throw error;
      }
    }
    return result;
  };
  const providers = {
    dingtalk: async ({ title, text }) => {
      if (settings.deliveryMode === "webhook") {
        const report = await sendDingTalkWebhookMarkdown({
          webhook: secrets.dingtalkWebhook,
          webhookSecret: secrets.dingtalkWebhookSecret,
          title,
          text,
        });
        const mention = settings.dingtalkTargetUserId
          ? await sendDingTalkWebhookText({
              webhook: secrets.dingtalkWebhook,
              webhookSecret: secrets.dingtalkWebhookSecret,
              text: buildInventoryMentionText({
                targetUserId: settings.dingtalkTargetUserId,
                targetName: settings.dingtalkTargetName || "负责人",
              }),
              atUserIds: [settings.dingtalkTargetUserId],
            })
          : null;
        return { report, mention };
      }
      return sendDingTalkAppRobotMessage({
        clientId: secrets.dingtalkClientId,
        clientSecret: secrets.dingtalkClientSecret,
        robotCode: settings.dingtalkRobotCode,
        conversationId: settings.dingtalkConversationId,
        msgKey: "sampleMarkdown",
        msgParam: {
          title,
          text:
            settings.dingtalkTargetUserId && settings.dingtalkTargetName
              ? "@" + settings.dingtalkTargetName + "\n\n" + text
              : text,
        },
      });
    },
    feishu: async ({ title, text }) =>
      new sdk.Feishu({
        FEISHU_APP_ID: s.feishuAppId,
        FEISHU_APP_SECRET: secrets.feishuAppSecret,
      }).send(title, text, {
        receive_id_type: s.feishuReceiveIdType,
        receive_id: s.feishuReceiveId,
        msg_type: "text",
      }),
    wecom: async ({ title, text }) => {
      let key = secrets.wecomKey;
      if (/^https?:/.test(key)) {
        const url = new URL(key);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "qyapi.weixin.qq.com" ||
          !url.searchParams.get("key")
        )
          throw Object.assign(Error("无效企业微信地址"), {
            code: "INVALID_CONFIG",
          });
        key = url.searchParams.get("key");
      }
      const sender = new sdk.WechatRobot({ WECHAT_ROBOT_KEY: key });
      return sendChunks("wecom", title + "\n" + text, 2000, true, (part) =>
        sender.send("", part, { msgtype: "text" }),
      );
    },
    email: async ({ title, text }) => {
      // Nodemailer's public transport API lets us require TLS on STARTTLS ports.
      const transport = nodemailer.createTransport({
        host: s.emailHost,
        port: s.emailPort,
        secure: s.emailPort === 465,
        requireTLS: s.emailPort !== 465,
        auth: { user: s.emailUser, pass: secrets.emailPassword },
        logger: false,
        debug: false,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        tls: { minVersion: "TLSv1.2" },
      });
      try {
        return {
          status: 200,
          data: await transport.sendMail({
            from: s.emailUser,
            to: s.emailTo.replaceAll(";", ","),
            subject: title,
            text,
          }),
        };
      } finally {
        transport.close();
      }
    },
    telegram: async ({ title, text }) => {
      if (
        secrets.telegramProxyUrl &&
        !/^(https?|socks[45]h?):\/\//i.test(secrets.telegramProxyUrl)
      )
        throw Object.assign(Error("无效代理"), { code: "INVALID_CONFIG" });
      const sender = new sdk.Telegram({
        TELEGRAM_BOT_TOKEN: secrets.telegramBotToken,
        TELEGRAM_CHAT_ID: Number(s.telegramChatId),
        PROXY_URL: secrets.telegramProxyUrl || undefined,
      });
      return sendChunks("telegram", title + "\n" + text, 3500, false, (part) =>
        sender.send("", part),
      );
    },
  };
  return Object.fromEntries(
    Object.entries(providers).map(([id, send]) => [
      id,
      (payload) => sdkRequestScope.run(true, () => send(payload)),
    ]),
  );
}
export async function sendNotificationReport({
  title,
  text,
  settings = {},
  secrets = {},
  providers,
  onlyChannels,
}) {
  const check = validateNotifications(
    settings,
    Object.fromEntries(
      Object.entries(secrets).map(([k, v]) => [k, Boolean(v)]),
    ),
    { requireEnabled: true },
  );
  if (!check.ok) throw Error(check.errors.join("；"));
  const enabled = enabledNotificationChannels(settings).filter(
    (id) => !onlyChannels || onlyChannels.includes(id),
  );
  if (!enabled.length) throw Error("没有可发送的通知渠道");
  const senders = providers || (await sdkProviders(settings, secrets)),
    channels = {};
  // Deliberately no automatic retries: a timeout may follow provider acceptance.
  for (const id of enabled) {
    try {
      const result = await senders[id]({ title, text });
      const accepted = providerAccepted(id, result),
        partialMail =
          id === "email" &&
          result?.data?.accepted?.length &&
          result?.data?.rejected?.length;
      const data = result?.data;
      const rejected =
        (result?.status >= 400 && result?.status < 500) ||
        (id === "feishu" &&
          typeof data?.code === "number" &&
          data.code !== 0) ||
        (id === "wecom" &&
          typeof data?.errcode === "number" &&
          data.errcode !== 0) ||
        (id === "telegram" && data?.ok === false) ||
        (id === "dingtalk" &&
          typeof result?.errcode === "number" &&
          result.errcode !== 0) ||
        (id === "email" && data?.rejected?.length && !data?.accepted?.length);
      const receipt =
        result?.processQueryKey ||
        result?.data?.data?.message_id ||
        result?.data?.result?.message_id ||
        result?.data?.messageId;
      channels[id] = {
        status: accepted
          ? "accepted"
          : partialMail || result?.status >= 500 || !rejected
            ? "unknown"
            : "failed",
        ...(accepted && receipt
          ? { receiptId: String(receipt).slice(0, 200) }
          : {}),
      };
    } catch (error) {
      const code = String(error.code || error.cause?.code || "");
      const preSendFailure =
        code === "INVALID_CONFIG" ||
        (id === "email" && ["EAUTH", "EENVELOPE"].includes(code));
      channels[id] = {
        status:
          !preSendFailure &&
          (/^(ETIMEDOUT|ECONNRESET|ECONNABORTED|EPIPE|UND_ERR_)/.test(code) ||
            !error.response)
            ? "unknown"
            : "failed",
        message: "该渠道发送未完成，请检查配置或服务商记录",
      };
    }
  }
  const count = Object.values(channels).filter(
    (r) => r.status === "accepted",
  ).length;
  return {
    accepted: count === enabled.length,
    status:
      count === enabled.length ? "accepted" : count ? "partial" : "failed",
    channels,
  };
}
