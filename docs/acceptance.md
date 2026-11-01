# Windows 0.9.4 验收状态

本轮测试完成后才发布安装器，产物与 Windows Sandbox 测试使用同一 SHA-256。

| 范围 | 结果 |
| --- | --- |
| 本地自动化测试 | 136 项通过，0 项失败 |
| GitHub Windows CI | [main 分支通过](https://github.com/907609732/cainiao-inventory/actions/runs/41319997648)，含测试及界面检查 |
| 源码与打包程序界面 | 版本 0.9.4；四个页面、库存读取通过，无渲染错误 |
| 全新安装 | 断网 Windows Sandbox 中 NSIS 静默安装成功，安装后的云仓窗口正常响应 |
| 重复安装 | 同一安装器再次安装成功，云仓窗口正常响应 |
| 卸载 | 卸载成功，程序可执行文件已移除 |
| 包内容 | 未包含账本、登录资料、更新凭据、旧发票目录或 macOS 插件 |
| 更新配置 | 指向 907609732/cainiao-inventory，SHA-512 清单与安装器一致 |

构建提交：`1593746a3686000187a475c5a951160319bf7589`。CI 提交：`7a361773fda90ab88f908fea2787611218e55f58`，后者只修正了测试夹具的临时目录真实路径比较，未改变打包运行代码。

## 验收边界

本轮未执行真实菜鸟采集、钉钉投递、0.9.3 到 0.9.4 的升级或正式业务数据迁移。重复安装测试不等于跨版本升级验收。安装器未进行 Authenticode 代码签名，因此保留 Pre-release 状态。

版本和校验值见 [0.9.4 发布说明](release-v0.9.4.md)。测试明细随 Release 的 `release-validation.json` 提供。

## 复核

按照 [Windows 说明](../windows/README.md) 安装依赖并准备 Electron 后，在仓库根目录运行 `npm test` 和 `npm run test:ui`。`windows/workbench/tests/windows-installer-sandbox.ps1` 仅允许在 Windows Sandbox 内执行，需将候选清单、安装包和结果目录分别映射至 C:\Kit、C:\Input、C:\Results。
