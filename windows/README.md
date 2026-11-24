# Windows 菜鸟云仓

**简体中文（默认）** | [English](README.en.md) · [返回首页](../README.md)

0.9.3、0.9.4 已因安装身份冲突撤回。安装修复版前，已发生覆盖的电脑应先恢复工作台；不要直接运行旧云仓卸载程序。

当前正式版为 **0.10.17**。[下载安装器及校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.17)。云仓独立运行，不依赖 ERP；APP、网页版和 AI 接口共用一个后台。建议使用 Node.js 24，与正式 CI 一致。

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

安装器输出为 `dist/CainiaoWarehouse-Setup-0.10.17-x64.exe`，同时生成 `latest.yml` 和差分更新索引。更新仓库为 `907609732/cainiao-inventory`。打包命令不自动发布，不应注入个人 GitHub 凭据。发布时核对版本、产物摘要、更新源及源码提交。

0.10.17 的构建、全新安装和从 0.10.6 升级的实际结果见 [Release 验收记录](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.17)。安装器未作 Authenticode 签名。

## 数据与源码范围

云仓保留运行概览、商品库存、销售趋势、云仓设置四个页面。源码树已移除旧发票缓存、独立 ERP 客户端和旧客户端迁移目录；旧安装包、测试数据及依赖缓存不留在源码目录。Windows 应用源码位于 `windows/workbench`，飞牛部署位于 `deploy/fnos`。

独立版数据与工作台分开；显式托管组件才使用宿主提供的数据位置。不要把源码目录当作正式账本目录；维护数据前退出相关服务并备份。详细功能见[使用说明](workbench/docs/feature-manual.md)。

## 公开 UI 演示

[界面与功能演示](../docs/ui-guide.md)使用独立虚构账本。仓库根目录运行 `npm run docs:screenshots` 可重新生成截图；不得改为读取正式数据库或账号目录。
