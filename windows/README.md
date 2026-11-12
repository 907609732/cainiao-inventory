# Windows 菜鸟云仓

**简体中文（默认）** | [English](README.en.md) · [返回首页](../README.md)

0.9.3、0.9.4 已因安装身份冲突撤回。安装修复版前，已发生覆盖的电脑应先恢复工作台；不要直接运行旧云仓卸载程序。

当前正式版为 **0.10.6**。[下载安装器及校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.6)。云仓独立运行，不依赖 ERP；APP、网页版和 AI 接口共用一个后台。建议使用 Node.js 24，与正式 CI 一致。

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

安装器输出为 `dist/CainiaoWarehouse-Setup-0.10.6-x64.exe`，同时生成 `latest.yml` 和差分更新索引。更新仓库为 `907609732/cainiao-inventory`。打包命令不自动发布，不应注入个人 GitHub 凭据。发布时核对版本、产物摘要、更新源及源码提交。

[0.10.6 Windows CI](https://github.com/907609732/cainiao-inventory/actions/runs/43260024922) 和[同次安装包验收](https://github.com/907609732/cainiao-inventory/actions/runs/43260030224)通过。安装测试涵盖全新安装、0.10.5 升级、重复安装、独立卸载身份、虚构库存与设置保留，以及 APP/网页共用后台。旧工作台公开基线包不可用，本轮未重复实测共存。真实平台采集、通知送达和数据迁移不属于本轮发布测试；安装器未作 Authenticode 签名。

## 数据与源码范围

云仓保留运行概览、商品库存、销售趋势、云仓设置四个页面。源码树已移除旧发票缓存、独立 ERP 客户端和旧客户端迁移目录；旧安装包、测试数据及依赖缓存不留在源码目录。Windows 应用源码位于 `windows/workbench`，飞牛部署位于 `deploy/fnos`。

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

扩展产物在 `release/windows/<tag>/`，包括云仓包、按需浏览器包、签名目录和摘要，发布仓库为 `907609732/cainiao-inventory`。扩展标签采用 `warehouse-<宿主版本>-<清单摘要>`；这与独立安装器的 `v0.10.5` 标签不同。主机范围和清单摘要必须按实际构建回执核对，构建成功不代表安装或正式数据迁移通过。

## 公开 UI 演示

[界面与功能演示](../docs/ui-guide.md)使用独立虚构账本。仓库根目录运行 `npm run docs:screenshots` 可重新生成截图；不得改为读取正式数据库或账号目录。
