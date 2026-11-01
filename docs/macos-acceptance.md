# macOS 插件 1.0.0 发布验收清单

本文仅针对 macOS 插件源码，不能作为 Windows 云仓 0.9.3 的验收结果。[返回当前软件说明](../README.md)。

正式标签和 Release 只能在以下检查全部通过后创建。

## 自动测试

- TypeScript 类型检查通过。
- Excel 正常、默认来源日延迟、缺列、公式不平、重复 SKU、跨日断层、零销量和大量预警用例通过。
- 报告策略、钉钉签名、429/5xx、结果不确定和重复发送用例通过。
- 中国时区、午夜、补跑窗口、运行锁和 launchd plist 用例通过。
- MCP tools/resources 可通过 MCP Inspector 列出和调用，stdout 不包含非协议输出。
- 插件、Skill、marketplace、构建产物和干净 HOME 安装验证通过。
- 新仓库不包含个人路径、服务器地址、真实库存、Webhook、Token、密码或现有 ERP 历史。

## 真实验收

1. 在当前 Mac 的隔离应用目录完成首次设置。
2. 使用当前菜鸟账号执行一次 `validate_only`，确认直接下载网站默认报表，并分别记录任务参考日和 Excel 来源日。
3. 发送唯一一条带“插件验收测试”标识的真实库存报告。
4. 确认钉钉群收到一条且仅一条。
5. 对同一报告再次执行发送，确认返回 `already_sent`。
6. 使用故意破坏的匿名 Excel，确认运行失败且钉钉零发送。
7. 安装 launchd 并触发一次非发送检查，确认调度状态与 MCP 一致。

## 发布产物

- `cainiao-inventory-codex-v1.0.0.zip`
- `cainiao-inventory-automation-core-1.0.0.tgz`
- `SHA256SUMS`
- Git 标签和 GitHub Release `v1.0.0`
