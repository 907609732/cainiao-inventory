# macOS Codex 插件源码

此目录说明独立的 macOS Codex 插件，源码版本为 1.0.0，与 Windows 云仓 0.9.3 的安装器分别管理。本仓库当前公开 Release 为 Windows v0.9.3；尚无远端 v1.0.0 标签，因此不提供依赖该标签的安装命令。

## 组成与开发

`packages/core` 提供库存下载校验、补货报告、钉钉投递和运行账本；`packages/mcp` 提供 MCP 入口；`plugins/cainiao-inventory-codex` 提供插件、Skill 和隔离运行时准备脚本。

在 macOS 仓库根目录执行：

```bash
npm ci
npm run build
npm test
npm run test:runtime
npm run validate
```

根目录的 `npm run dev` 为 Windows 云仓入口，不是 macOS 插件开发服务器。

## 配置与数据

插件使用本地设置向导完成浏览器登录、保存钉钉配置、真实只校验运行及调度设置。密钥使用 macOS Keychain，数据默认位于 `~/Library/Application Support/Cainiao Inventory Codex`。每日任务使用 launchd；这些步骤不适用于 Windows 安装器。

验证码、登录失效和平台改版需要人工处理。来源日、库存公式、重复 SKU 和库存连续性等校验失败时，不得发送旧库存。发送结果不确定时需要人工核对，不能当作成功。

详见 [macOS 架构](macos-architecture.md)、[验收清单](macos-acceptance.md)及[原 1.0.0 发布计划](macos-release-plan.md)。这些文档描述流程，不代表真实平台验收已完成。
