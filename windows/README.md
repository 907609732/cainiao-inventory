# Windows 工作台云仓扩展

`workbench/` 保存从五成 ERP 迁出的完整 Windows 云仓源码，包括库存、月度销量、补货、设置、提醒及业务适配器。现有 macOS Codex 插件保持原目录和构建入口。

Windows 扩展使用工作台已有的签名组件格式，模块 ID 为 `warehouse`，复用工作台 Electron。主包只保留云仓入口和安装能力；库存浏览器随扩展按需下载。用户在工作台中点击“下载并安装”后才开始准备组件。

## 构建

需要现有 Windows ERP 构建工具链与外部 Ed25519 签名密钥。两个仓库默认并排存放；路径不同时传 `--erp=完整ERP路径`。不把签名密钥复制到仓库。

```powershell
node scripts/build-windows.mjs
# 已有本次构建回执时，只验证并收集 Windows 扩展发布文件：
node scripts/build-windows.mjs --from-receipt
```

输出在 `release/windows/<tag>/`，包括云仓包、浏览器包、签名组件清单、摘要及宿主兼容说明。完整工作台构建读取本目录作为云仓源码；设置 `LINGTU_WAREHOUSE_SOURCE` 可改变源码位置。

## 发布与兼容

发布仓库固定为 `907609732/cainiao-inventory-codex`，使用独立 `warehouse-<宿主版本>-<清单摘要>` 标签，避免覆盖 macOS `v1.0.0`。工作台目前使用冻结的签名清单，兼容范围为构建时宿主的精确版本；扩展发布顺序应先于引用它的工作台发布。

扩展尚未完成实际安装与真实平台验收时，不应宣称可正式交付。发布前检查 `extension-release.json` 和对应工作台验收回执。

扩展激活沿用工作台注册表中原有数据位置。预览工作台只使用独立测试账本；正式身份和正式账本迁移需走 ERP 既有发布与迁移验收。

ERP 中历史源码暂作旧测试及兼容入口使用；新构建的云仓载荷读取本目录，轻量主包的文件断言禁止携带云仓源码与专属依赖。
