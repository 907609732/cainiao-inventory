# Windows 菜鸟云仓 0.9.3

当前版本为独立云仓安装版，GitHub 发布状态为 Pre-release。[下载安装器及校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.9.3)。

## 开发启动

在仓库根目录执行：

```powershell
npm --prefix windows/workbench ci --workspaces=false
node windows/workbench/node_modules/electron/install.js
npm run dev
```

进入 `windows/workbench` 后也可执行 `npm run dev`。两者均直接启动云仓，不再进入 ERP 三合一预览。普通源码启动会解析本机既有数据位置；自动化界面测试使用独立临时账本。

## 测试与安装器

在 `windows/workbench` 目录执行：

```powershell
npm test
npm run test:ui
npm run warehouse:build -- --publish never
```

安装器输出为 `dist/CloudWarehouseInventorySync-Setup-0.9.3-x64.exe`，同时生成 `latest.yml` 和差分更新索引。更新仓库为 `907609732/cainiao-inventory`。打包命令不自动发布，不应注入个人 GitHub 凭据。发布时核对版本、产物摘要、更新源及源码提交。

安装包构建时的 104 项相关测试及隔离启动检查已通过；后续源码清理的 136 项测试和四个页面的界面检查已通过。实际安装、真实平台采集 / 投递及正式数据迁移仍未验收。详见[验收说明](../docs/acceptance.md)。

## 数据与源码范围

云仓保留运行概览、商品库存、销售趋势、云仓设置四个页面。源码树已移除旧发票缓存、独立 ERP 客户端和旧客户端迁移目录；旧安装包、测试数据及依赖缓存不留在源码目录。当前仓库的 macOS 插件另行维护。

Windows 数据位置可由既有工作台位置绑定或显式启动参数指定。不要把源码目录当作正式账本目录；维护数据前退出相关服务并备份。详细功能见[使用说明](workbench/docs/feature-manual.md)。

## 工作台扩展集成

以下入口供现有 ERP 工具链使用，独立云仓开发和安装无需执行。签名扩展需外部 Ed25519 密钥及匹配的宿主版本；密钥不得放入仓库。

在仓库根目录执行：

```powershell
node scripts/build-windows.mjs
# 使用已有构建回执收集并校验扩展产物
node scripts/build-windows.mjs --from-receipt
```

两个仓库默认并排存放，其他位置通过 `--erp=完整ERP路径` 指定。`workbench/scripts/workbench-build.mjs` 与 `legacy-suite-build.mjs` 仍由现有 ERP 构建入口引用，属于保留的集成适配器。

扩展产物在 `release/windows/<tag>/`，包括云仓包、按需浏览器包、签名目录和摘要，发布仓库为 `907609732/cainiao-inventory`。扩展标签采用 `warehouse-<宿主版本>-<清单摘要>`；这与独立安装器的 `v0.9.3` 标签不同。主机范围和清单摘要必须按实际构建回执核对，构建成功不代表安装或正式数据迁移通过。
