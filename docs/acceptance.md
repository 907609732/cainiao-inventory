# Windows 0.9.3 验收状态

## 已有证据

| 范围 | 结果 |
| --- | --- |
| 安装器构建 | Windows x64 NSIS 安装器生成成功，130,704,110 字节 |
| 发布时相关测试 | 104 项通过，0 项失败 |
| 打包程序检查 | 独立测试账本下打开云仓窗口，库存读取成功 |
| 源码清理回归 | 136 项通过，0 项失败 |
| 清理后的界面 | 四个当前页面可打开，库存读取成功，无渲染错误 |
| 发布附件 | GitHub 附件大小及 SHA-256 与本地产物一致 |
| 更新配置 | 指向 907609732/cainiao-inventory |
| 敏感资料 | 未打包本地账本、登录资料或内置更新凭据；源码变更扫描未发现泄露 |

发布产物绑定提交 `98a28c522c69c436272a8cc2948f1bc5a2b851fe`；源码清理提交为 `56a2dac`。后续文档和源码整理不会替换已发布安装器。

## 尚未完成

- 实际执行安装器安装及卸载验收。
- 使用真实账号完成菜鸟采集与钉钉投递验收。
- 正式业务数据迁移及在原安装环境中的升级验收。

因此 [v0.9.3](https://github.com/907609732/cainiao-inventory/releases/tag/v0.9.3) 保持 Pre-release。安装器未进行 Authenticode 代码签名。测试通过不代表上述现场验收完成。

## 复核命令

在 `windows/workbench` 安装依赖并准备 Electron 后执行：

```powershell
npm test
npm run test:ui
npm run warehouse:build -- --publish never
```

首次安装依赖和准备 Electron 的命令见 [Windows 开发说明](../windows/README.md)。重新构建会产生新文件，应重新核对摘要，不能复用本次发布的校验值。
