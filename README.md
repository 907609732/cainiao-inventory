# 菜鸟库存自动化 Codex 插件

Windows 云仓最新版源码位于 [`windows/workbench`](windows/workbench)，当前版本 `0.9.3`。首次执行 `npm --prefix windows/workbench ci --workspaces=false`，之后在仓库根目录执行 `npm run dev` 启动云仓。Windows 打包与验收见 [Windows 说明](windows/README.md)。

这是一个独立的 macOS Codex 插件，用于每天抓取菜鸟云仓库存、验证 Excel、生成补货预警，并安全发送到钉钉。数据验证失败、登录失效或页面导出失败时，任务会停止，不会发送旧库存。

## 安装

```bash
codex plugin marketplace add 907609732/cainiao-inventory-codex --ref v1.0.0
codex plugin add cainiao-inventory-codex@cainiao-tools
```

安装后新建一个 Codex 任务并输入：

```text
检查并配置我的菜鸟库存自动化
```

Codex 会先运行体检，再打开只监听 `127.0.0.1` 的设置向导。菜鸟登录、钉钉 Webhook 和 Secret 不需要发到聊天中。

## 首次设置

设置向导依次完成：

1. 准备隔离 Node.js 22.23.1、Playwright 1.61.1 和 Chromium。
2. 打开专用浏览器 Profile，手动完成一次菜鸟登录或验证码。
3. 把钉钉 Webhook 和加签 Secret 保存到 macOS Keychain。
4. 发送一条不包含业务数据的连接测试。
5. 选择每天发送摘要，或仅严重缺货时发送。
6. 真实抓取一次库存但不发送业务日报。
7. 启用中国时间每天 22:00 的 launchd 任务。

只有以上验收通过后，向导才允许启用每日任务。

## 数据规则

菜鸟云仓库存数据存在正常延迟。自动化不会填写日期或追取当天数据，而是直接下载网站当前默认报表，并把 Excel 内的唯一日期作为权威来源日。任务参考日与来源日会分别记录。发送前会检查：

- 必需列和最低行数。
- SKU/货品条码唯一且不为空。
- 库存和销量字段为非负数字。
- `期初库存 + 入库汇总 - 出库汇总 = 期末库存`。
- Excel 只有一个有效来源日。
- 与前一日有效快照重合的 SKU 库存连续。

报告按照近 30 天销量估算可售天数，默认分为少于 7 天、少于 15 天、少于 30 天和正常。

## 本地数据

所有运行数据保存在：

```text
~/Library/Application Support/Cainiao Inventory Codex
```

钉钉 Webhook、加签 Secret、可选回调 URL 和 Token 存在 macOS Keychain。应用目录中只保存非敏感配置、专用浏览器 Profile、原始 Excel、规范化快照、报告、运行清单和本地诊断。

## 常用请求

```text
检查菜鸟库存自动化是否正常
抓取菜鸟默认最新库存，验证后发送钉钉
只抓取并验证，不发送消息
查看最近一次库存任务为什么失败
停用每天 22 点的库存任务
```

## 模块与 CLI

核心模块位于 `packages/core`，公开 `createCainiaoAutomation()` 和以下方法：

```text
doctor login runInventory getStatus installSchedule removeSchedule
```

构建后可直接运行：

```bash
node packages/core/dist/cli.cjs doctor
node packages/core/dist/cli.cjs run --validate-only
node packages/core/dist/cli.cjs status
```

## 开发与验证

```bash
npm ci
npm test
npm run test:runtime
npm run build
npm run validate
npm run test:install
npm run pack:release
```

架构和完整执行顺序见 [docs/architecture.md](docs/architecture.md)，发布验收见 [docs/acceptance.md](docs/acceptance.md)。

## 支持边界

v1 支持 macOS 13+、Intel 和 Apple Silicon。安装者需要有效的菜鸟库存权限、可用钉钉机器人、互联网连接和已登录的 macOS 图形用户会话。

验证码、账户风控、网络中断和未来的菜鸟页面改版属于外部条件。插件保证这些问题出现时明确失败并阻止错误发送，但不会尝试绕过安全验证。

## License

MIT


## Windows 工作台扩展

Windows 五成工作台的完整菜鸟云仓功能现独立维护在 [`windows/workbench`](windows/workbench)。构建、兼容和发布说明见 [Windows 扩展说明](windows/README.md)。原有 macOS Codex 插件仍使用上文的安装与构建方式。
