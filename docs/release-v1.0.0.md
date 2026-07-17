# 菜鸟库存自动化 Codex 插件 v1.0.0

## 安装

```bash
codex plugin marketplace add 907609732/cainiao-inventory-codex --ref v1.0.0
codex plugin add cainiao-inventory-codex@cainiao-tools
```

安装后在 Codex 中输入“检查并配置我的菜鸟库存自动化”。插件会打开本机设置向导，依次准备隔离运行时、验证菜鸟登录、保存钉钉凭证、运行真实 dry-run，并安装中国时间每天 22:00 的任务。

## 安全保证

- 菜鸟密码、验证码、钉钉 Webhook 与 Secret 不进入聊天或配置文件。
- 来源日期、列、数值、库存公式、重复 SKU 和跨日连续性全部通过后才可能发送。
- 请求结果不确定时标记 `delivery_unknown`，调度器冻结该查询日，必须人工明确重试。
- 失败截图、HTML 和日志仅保存在当前 Mac，并按保留策略自动清理。

## 支持范围

v1 支持 macOS 13+ 的 Intel 与 Apple Silicon，需要有效菜鸟权限、钉钉机器人、互联网连接和图形用户会话。验证码、平台风控、网络故障和未来页面改版会明确失败，插件不会绕过这些外部限制。
