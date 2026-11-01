# 当前软件架构

本文对应 Windows 云仓 0.9.3。macOS Codex 插件见 [macOS 架构](macos-architecture.md)。

## Windows 主链路

`desktop/main.mjs` 启动 Electron 窗口，`desktop/preload.cjs` 提供受控 IPC，`desktop/renderer` 提供运行概览、商品库存、销售趋势和云仓设置。

采集任务由主进程启动独立子进程，通过 `core` 中的 Playwright 逻辑访问菜鸟并下载报表，再执行校验、SQLite 入库和钉钉投递。读取页面数据与触发平台采集分开；投递结果未知时不能视为发送成功。

- 库存与校验：`windows/workbench/core/erp`。
- 任务、配置和数据位置：`windows/workbench/desktop/shared`。
- 云仓受控业务接口：`windows/workbench/desktop/modules/cloud-control.mjs`、`desktop/workbench/warehouse-agent*.mjs`。
- 安装器：`windows/workbench/build/electron-builder.config.cjs`。
- 工作台签名扩展：仓库根目录 `scripts/build-windows.mjs`，依赖外部 ERP 工具链。

## 数据边界

源码树不保存正式库存、登录资料、密钥或构建凭据。普通启动会按已有位置绑定解析账本；隔离测试显式创建临时配置及账本。不能靠重建身份或空账本绕过原数据位置检查。

旧发票模块缓存、独立 ERP 客户端和旧客户端迁移目录已从当前源码清理。与现有工作台对接的签名、请求验证及服务适配仍保留，不能仅因名称含工作台而删除。

## 平台区分

`packages/core`、`packages/mcp` 和 `plugins` 是 macOS Codex 插件源码，使用 Keychain 和 launchd。Windows 桌面程序使用 Electron 和 Windows 安全存储；两端版本号、入口及验收结果分别记录。
