# 多渠道通知

0.10.6 正式版在云仓设置的“通知渠道”中支持以下配置，可同时启用多个渠道。同一份库存报告会逐个投递到已启用渠道，分别记录受理、失败或结果不明。保存设置不会发消息。

| 渠道 | 配置 |
| --- | --- |
| 钉钉 | 保留企业应用机器人与群 Webhook，兼容已有目标用户提醒 |
| 飞书应用机器人 | App ID、App Secret、接收 ID 类型与接收 ID；默认 chat_id，需要应用消息发送权限及目标访问权限 |
| 企业微信群机器人 | 机器人 Key，或包含 Key 的官方 Webhook URL |
| 邮箱 SMTP | 服务器、端口、发件邮箱、授权码及收件邮箱；多个收件人用逗号分隔。465 使用 TLS，其他端口必须协商 STARTTLS |
| Telegram | Bot Token、数字 Chat ID、可选 HTTP/SOCKS 代理；清空代理并保存可恢复直连 |

新增渠道默认关闭，旧版钉钉默认保持启用。可以关闭钉钉并只启用其他渠道。Windows 使用 safeStorage 加密；飞牛使用本应用独立主密钥加密。密钥、授权码、Webhook Key 和代理地址不写入普通设置 JSON。

发送会核对各平台业务回执，而不只看 HTTP 状态。一个渠道失败不阻止其他渠道；部分成功不能视为全部完成。月报按渠道保留发送记录，已受理、处理中或结果不明的渠道不会自动重发，只重试明确失败的渠道。长文本按渠道限制分段；分段后若只有部分受理，保持结果不明，避免重发前半段。

上游组件的 HTTP 错误可能包含请求配置，适配层会在 SDK 调用范围内先处理这些响应，禁止原始密钥进入错误日志。错误输出只保留通用说明和脱敏回执。SMTP 强制使用 TLS 或 STARTTLS，不关闭证书验证。

## 开源依赖

- [push-all-in-one 4.6.0](https://github.com/CaoMeiYouRen/push-all-in-one/tree/v4.6.0)：MIT，复用飞书、企业微信及 Telegram 封装。沿用已验证的固定版本，未在此次发布升级依赖。
- [Nodemailer](https://github.com/nodemailer/nodemailer)：复用 SMTP 发送与 TLS 协商，固定 9.0.3。
- 钉钉保留原有已验证的发送与 @提醒流程。

许可证保存在 [licenses](licenses) 中。平台协议使用上述开源组件，本项目仅增加配置、报告投递编排和回执记录。

## 验证范围

0.10.6 的 [Windows CI](https://github.com/907609732/cainiao-inventory/actions/runs/43260024922) 和[飞牛构建检查](https://github.com/907609732/cainiao-inventory/actions/runs/43260025032)通过。自动测试使用临时配置、临时 SQLite 和模拟服务商响应，覆盖配置、加密、代理清空、长文本、业务回执、部分失败及未知结果不重发。

本轮发布测试没有使用真实账号发送飞书、企业微信、邮件或 Telegram，也未验证收件人收到或阅读。真实投递需配置权限和目标后单独验证。此前授权 NAS 的钉钉发送与部署结果记录在[飞牛验收历史](fnos-deployment.md)，不能代替其他平台送达证明。

[0.10.6 正式发布及安装验收记录](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.6)。安装包测试不触发真实库存采集或业务通知。
