# 菜鸟云仓

[**Releases · 下载安装包**](https://github.com/907609732/cainiao-inventory/releases)

> **0.9.3、0.9.4 已撤回，请勿继续安装。** 旧包复用了电商工作台的安装身份，存在覆盖风险。已发生覆盖时不要直接运行旧卸载程序，应先备份并恢复工作台。

当前修复版本为 **0.9.5**。菜鸟云仓与五成电子商务工作台是两款独立软件，分别安装、配置和卸载。

## 下载

[下载 Windows x64 安装器（约 125 MiB）](https://github.com/907609732/cainiao-inventory/releases/download/v0.9.5/CainiaoWarehouse-Setup-0.9.5-x64.exe) · [发布及测试记录](https://github.com/907609732/cainiao-inventory/releases/tag/v0.9.5)

## 两款软件分别安装

| 项目 | 五成电子商务工作台 | 菜鸟云仓 0.9.5 |
| --- | --- | --- |
| 程序目录 | `%LOCALAPPDATA%\Programs\wucheng-ecommerce-erp-v2` | `%LOCALAPPDATA%\Programs\CainiaoWarehouse` |
| 主程序 | 原工作台主程序 | `CainiaoWarehouse.exe` |
| 数据 | 沿用工作台既有位置绑定和账本 | `%APPDATA%\cainiao-cloud-warehouse` |
| 快捷方式 | 五成电子商务工作台 | 菜鸟云仓 |
| 卸载项 | 工作台独立卸载项 | 菜鸟云仓独立卸载项 |

独立云仓不再自动继承工作台的数据位置、设置、登录资料或注册表。首次使用需单独配置菜鸟登录和钉钉目标；本版不自动迁移工作台账本。

## 当前功能

| 页面 | 用途 |
| --- | --- |
| 运行概览 | 查看任务状态、日志，按配置同步并发送 |
| 商品库存 | 查看已保存库存、筛选预警商品和补货需求 |
| 销售趋势 | 查看云仓月度出库销量、排名及趋势 |
| 云仓设置 | 配置菜鸟登录、钉钉目标及自动化，查看使用说明 |

刷新库存与统计只读取已保存数据。云仓销量不等于店铺销售额，缺失月份不能当作零销量。

## 界面预览（全部为虚构测试数据）

以下截图从 0.9.5 独立版真实界面重新生成，使用 8 个 DEMO 商品和独立临时账本。未读取正式业务数据，未使用用户业务截图；账号为测试占位，密码与密钥均留空。每张图片均标有“演示数据”。

### 运行概览

查看运行状态、下次执行时间和任务日志；按配置手动同步。演示自动任务已关闭。

![运行概览——测试数据](docs/images/ui-demo/overview.png)

### 商品库存

查看库存汇总、来源日、可售天数和补货预警，支持搜索、排序及严重缺货筛选。图中 8 个虚构 SKU 合计 316 件。

![商品库存——虚构商品与库存](docs/images/ui-demo/inventory.png)

### 销售趋势

查看月度 / 年度曲线、有效月份和商品排名，支持单品及多商品比较。缺失月份保留断点，云仓销量不等于店铺收入。

![销售趋势——虚构销量](docs/images/ui-demo/sales-overall.png)

### 云仓设置

分别配置菜鸟账号、钉钉机器人和自动任务，查看使用说明、维护入口及更新状态。截图为设置页节选，所有密钥为空。

![云仓设置——测试账号与空密钥](docs/images/ui-demo/settings.png)

[查看完整 UI 功能演示、单品 / 多商品截图和演示数据说明](docs/ui-guide.md)。截图中的“校验通过”为预置演示状态，不代表真实采集或投递已完成。

## 源码启动

需要 Windows、Node.js 22 或更新版本及 npm，在仓库根目录运行：

```powershell
npm --prefix windows/workbench ci --workspaces=false
node windows/workbench/node_modules/electron/install.js
npm run dev
```

根目录 `npm test` 运行回归测试，`npm run test:ui` 检查独立界面，`npm run build` 生成安装器。普通启动使用云仓独立数据目录；自动化测试使用临时账本。

## 发布前验证

140 项测试、源码与打包界面检查及 Windows CI 通过。Windows Sandbox 使用真实工作台安装器完成共存测试：安装和重复安装云仓后，工作台文件、快捷方式、卸载项和数据绑定保持不变；卸载云仓后工作台仍可启动。修复后的本机也已核对两款软件同时运行。

真实菜鸟采集、钉钉投递和账本迁移未在本轮测试中执行，安装器未作 Authenticode 代码签名。

## 文档

- [UI 界面与虚构数据功能演示](docs/ui-guide.md)

- [Windows 开发与构建](windows/README.md)
- [功能说明书](windows/workbench/docs/feature-manual.md)
- [架构与数据边界](docs/architecture.md)
- [验收范围](docs/acceptance.md)
- [0.9.5 修复说明](docs/release-v0.9.5.md)

源码位于 `windows/workbench`，仅维护 Windows 版本。MIT License。
