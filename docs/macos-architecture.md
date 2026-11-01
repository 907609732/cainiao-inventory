# macOS 插件架构与执行流程

本文仅针对 macOS 插件源码，不能作为 Windows 云仓 0.9.3 的验收结果。[返回当前软件说明](../README.md)。

## 组件

- `cainiao-inventory-automation-core`：配置、日期、Excel 验真、报告、Keychain、钉钉、运行账本和 launchd。
- 浏览器工作进程：使用独立 Playwright Profile 完成登录和默认报表下载。
- `cainiaoInventory` MCP：把体检、设置、运行、状态和调度暴露给 Codex。
- `cainiao-inventory-automation` Skill：规定 Codex 的调用顺序和安全边界。
- localhost 设置向导：处理敏感配置、真实 dry-run 和调度启用。

## 首次设置

```mermaid
flowchart TD
  A[安装插件] --> B[MCP 环境体检]
  B --> C[localhost 设置向导]
  C --> D[准备隔离运行时]
  D --> E[专用浏览器登录]
  E --> F[Keychain 保存钉钉凭证]
  F --> G[无业务数据连接测试]
  G --> H[真实抓取 dry-run]
  H --> I{全部通过}
  I -- 否 --> J[修复并保留本地诊断]
  I -- 是 --> K[安装 launchd]
```

## 每日执行

```mermaid
flowchart TD
  A[15 分钟 due check] --> B{已到中国时间目标且未成功}
  B -- 否 --> Z[退出]
  B -- 是 --> C[获取运行锁]
  C --> D[直接下载网站默认最新 Excel]
  D --> E[SHA-256 与来源日验真]
  E --> F{所有校验通过}
  F -- 否 --> X[失败且不发送]
  F -- 是 --> G[原子保存快照与报告]
  G --> H[报告策略与幂等检查]
  H --> I[钉钉发送]
  I --> J[可选 HMAC 回调]
  J --> K[写入最终运行清单]
```

## 幂等与失败模型

钉钉幂等键由来源日、报告 SHA-256 和目标 Webhook 指纹组成。已成功发送的键不会再次发送，除非用户明确要求强制重发。

明确的 HTTP 或钉钉错误记录为 `failed`。请求超时或连接中断可能发生在钉钉已接收消息之后，因此记录为 `delivery_unknown`，不会自动重发。

## 调度

LaunchAgent `com.907609732.cainiao-inventory` 每 900 秒运行一次轻量检查。检查以 `Asia/Shanghai` 为准，不受 Mac 本地夏令时变化影响。22:00 错过后在 24 小时内补跑，超过窗口只记录未执行，不连续追发多日历史日报。

## 文件与权限

应用目录和业务文件使用仅当前用户可访问的权限。原始 Excel 默认保留 30 天，日志 30 天，失败页面截图和 HTML 7 天，规范化快照与运行清单长期保留。
