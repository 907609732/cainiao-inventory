# 菜鸟云仓库存同步

> **安装警告：0.9.3、0.9.4 已撤回。旧安装包与电商工作台共用安装身份，可能覆盖工作台。请勿继续安装或直接卸载覆盖版本。0.9.5 正在进行独立安装与共存验收。**

[**Releases · 下载安装包**](https://github.com/907609732/cainiao-inventory/releases)

Windows 桌面软件，当前发布版本 **0.9.4（正式 Release）**，用于菜鸟云仓库存采集、Excel 校验、补货预警、月度销量统计和钉钉通知。

## 下载

- [下载 Windows x64 安装器（约 125 MiB）](https://github.com/907609732/cainiao-inventory/releases/download/v0.9.4/CloudWarehouseInventorySync-Setup-0.9.4-x64.exe)
- [0.9.4 发布说明与校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.9.4)

安装器直接打开云仓界面。当前版本已发布为正式 Release，已完成隔离安装、重复安装、启动与卸载测试；真实菜鸟采集 / 钉钉投递和正式数据迁移尚未验收；安装器未进行 Authenticode 代码签名。

## 当前功能

| 页面 | 用途 |
| --- | --- |
| 运行概览 | 查看任务状态、执行日志，按配置同步并发送 |
| 商品库存 | 查看已保存的库存、筛选预警商品和补货需求 |
| 销售趋势 | 查看云仓月度出库销量、排名和商品趋势 |
| 云仓设置 | 配置菜鸟登录、钉钉目标及自动化，查看使用说明 |

首次使用先完成菜鸟登录和钉钉配置，再分别确认采集、校验、入库及投递结果。刷新库存和统计只读取已保存数据。云仓销量不等于店铺销售额，缺失月份不能当作零销量。

## 从源码启动

需要 Windows、Node.js 22 或更新版本及 npm。在仓库根目录执行：

```powershell
npm --prefix windows/workbench ci --workspaces=false
node windows/workbench/node_modules/electron/install.js
npm run dev
```

源码入口为 [windows/workbench/desktop/main.mjs](windows/workbench/desktop/main.mjs)。开发依赖、安装包和测试账本不随源码提交。源码默认沿用本机数据位置；隔离测试使用独立临时账本，操作前核对当前数据环境。

## 文档

- [Windows 开发、打包与工作台集成](windows/README.md)
- [功能说明书与技术原理](windows/workbench/docs/feature-manual.md)
- [当前架构](docs/architecture.md)
- [验证结果与验收边界](docs/acceptance.md)
- [0.9.4 版本说明](docs/release-v0.9.4.md)

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `windows/workbench` | 当前 Windows 云仓源码、测试、文档和安装器配置 |
| `scripts/build-windows.mjs` | 对接现有 ERP 工具链的签名扩展构建入口 |
| `docs` | 当前版本、架构及验收说明 |

本仓库仅维护 Windows 菜鸟云仓，版本号为 0.9.4。根目录的启动、测试和构建命令均转发到 Windows 源码。

## License

MIT
