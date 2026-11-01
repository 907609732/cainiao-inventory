export const NOTIFICATION_CHANNELS = [
  "dingtalk",
  "feishu",
  "wecom",
  "email",
  "telegram",
];
export const NOTIFICATION_SECRET_FIELDS = [
  "feishuAppSecret",
  "wecomKey",
  "emailPassword",
  "telegramBotToken",
  "telegramProxyUrl",
];
export const NOTIFICATION_DEFAULTS = Object.freeze({
  dingtalkEnabled: true,
  feishuEnabled: false,
  feishuAppId: "",
  feishuReceiveIdType: "chat_id",
  feishuReceiveId: "",
  wecomEnabled: false,
  emailEnabled: false,
  emailHost: "",
  emailPort: 465,
  emailUser: "",
  emailTo: "",
  telegramEnabled: false,
  telegramChatId: "",
});
export function normalizeNotificationSettings(input = {}) {
  const s = { ...NOTIFICATION_DEFAULTS };
  for (const k of Object.keys(s)) if (k in input) s[k] = input[k];
  for (const id of NOTIFICATION_CHANNELS)
    s[id + "Enabled"] = Boolean(s[id + "Enabled"]);
  for (const k of Object.keys(s))
    if (typeof NOTIFICATION_DEFAULTS[k] === "string")
      s[k] = String(s[k] || "").trim();
  s.emailPort = Number(s.emailPort);
  return s;
}
export function enabledNotificationChannels(settings = {}) {
  const s = normalizeNotificationSettings(settings);
  return NOTIFICATION_CHANNELS.filter((id) => s[id + "Enabled"]);
}
export function validateNotifications(
  settings = {},
  flags = {},
  { requireEnabled = false } = {},
) {
  const s = { ...settings, ...normalizeNotificationSettings(settings) },
    errors = [],
    required = (yes, label) => {
      if (!yes) errors.push("请填写" + label);
    };
  if (requireEnabled && !enabledNotificationChannels(s).length)
    errors.push("请至少启用一个通知渠道");
  if (s.dingtalkEnabled) {
    if (s.deliveryMode !== "webhook") {
      required(flags.dingtalkClientId, "钉钉 Client ID");
      required(flags.dingtalkClientSecret, "钉钉 Client Secret");
      required(s.dingtalkRobotCode, "钉钉 Robot Code");
      required(s.dingtalkConversationId, "钉钉群会话 ID");
    } else required(flags.dingtalkWebhook, "钉钉 Webhook 地址");
  }
  if (s.feishuEnabled) {
    required(s.feishuAppId, "飞书 App ID");
    required(flags.feishuAppSecret, "飞书 App Secret");
    required(s.feishuReceiveId, "飞书接收目标");
    if (
      !["chat_id", "open_id", "union_id", "user_id", "email"].includes(
        s.feishuReceiveIdType,
      )
    )
      errors.push("飞书接收目标类型无效");
  }
  if (s.wecomEnabled) required(flags.wecomKey, "企业微信群机器人 Key");
  if (s.emailEnabled) {
    required(s.emailHost, "SMTP 服务器");
    required(flags.emailPassword, "SMTP 授权码");
    if (!/^[a-zA-Z0-9.-]+$/.test(s.emailHost))
      errors.push("SMTP 服务器应为主机名");
    if (
      !Number.isInteger(s.emailPort) ||
      s.emailPort < 1 ||
      s.emailPort > 65535
    )
      errors.push("SMTP 端口无效");
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s.emailUser))
      errors.push("发件邮箱应为单个邮箱地址");
    for (const [value, label] of [
      [s.emailUser, "发件邮箱"],
      [s.emailTo, "收件邮箱"],
    ])
      if (
        !value
          .split(/[,;]/)
          .every((x) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(x.trim())) ||
        !value
      )
        errors.push(label + "格式无效");
  }
  if (s.telegramEnabled) {
    required(flags.telegramBotToken, "Telegram Bot Token");
    if (
      !/^-?\d+$/.test(s.telegramChatId) ||
      !Number.isSafeInteger(Number(s.telegramChatId))
    )
      errors.push("Telegram Chat ID 应为有效数字");
  }
  return { ok: errors.length === 0, errors, value: s };
}
