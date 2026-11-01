# Windows 菜鸟云仓 0.9.5

0.9.3、0.9.4 已因安装身份冲突撤回。安装修复版前，已发生覆盖的电脑应先恢复工作台；不要直接运行旧云仓卸载程序。

当前版本为独立云仓安装版，GitHub 发布状态为正式 Release（Latest）。[下载安装器及校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.9.5)。

## 开发启动

在仓库根目录执行：

```powershell
npm --prefix windows/workbench ci --workspaces=false
node windows/workbench/node_modules/electron/install.js
npm run dev
```

进入 `windows/workbench` 后也可执行 `npm run dev`。两者均直接启动云仓，不再进入 ERP 三合一预览。独立版默认使用 %APPDATA%\cainiao-cloud-warehouse，不读取工作台的默认位置记录；自动化测试使用临时账本。

## 测试与安装器

在 `windows/workbench` 目录执行：

```powershell
npm test
npm run test:ui
npm run warehouse:build -- --publish never
```

安装器输出为 `dist/CainiaoWarehouse-Setup-0.9.5-x64.exe`，同时生成 `latest.yml` 和差分更新索引。更新仓库为 `907609732/cainiao-inventory`。打包命令不自动发布，不应注入个人 GitHub 凭据。发布时核对版本、产物摘要、更新源及源码提交。

140 项自动化测试、独立界面和 Windows CI 通过。Sandbox 已验证真实工作台与云仓共存、重复安装以及卸载云仓后工作台仍可用。本机已核验两款软件同时运行。真实平台采集 / 投递和业务数据迁移未在本轮验收。详见[验收说明](../docs/acceptance.md)。

## 数据与源码范围

云仓保留运行概览、商品库存、销售趋势、云仓设置四个页面。源码树已移除旧发票缓存、独立 ERP 客户端和旧客户端迁移目录；旧安装包、测试数据及依赖缓存不留在源码目录。本仓库仅保留 Windows 云仓源码。

独立版数据与工作台分开；显式托管组件才使用宿主提供的数据位置。不要把源码目录当作正式账本目录；维护数据前退出相关服务并备份。详细功能见[使用说明](workbench/docs/feature-manual.md)。

## 工作台扩展集成

以下入口供现有 ERP 工具链使用，独立云仓开发和安装无需执行。签名扩展需外部 Ed25519 密钥及匹配的宿主版本；密钥不得放入仓库。

在仓库根目录执行：

```powershell
node scripts/build-windows.mjs
# 使用已有构建回执收集并校验扩展产物
node scripts/build-windows.mjs --from-receipt
```

两个仓库默认并排存放，其他位置通过 `--erp=完整ERP路径` 指定。`workbench/scripts/workbench-build.mjs` 与 `legacy-suite-build.mjs` 仍由现有 ERP 构建入口引用，属于保留的集成适配器。

扩展产物在 `release/windows/<tag>/`，包括云仓包、按需浏览器包、签名目录和摘要，发布仓库为 `907609732/cainiao-inventory`。扩展标签采用 `warehouse-<宿主版本>-<清单摘要>`；这与独立安装器的 `v0.9.5` 标签不同。主机范围和清单摘要必须按实际构建回执核对，构建成功不代表安装或正式数据迁移通过。
