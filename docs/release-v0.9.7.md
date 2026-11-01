# 菜鸟云仓 0.9.7

[下载 Windows x64 安装器](https://github.com/907609732/cainiao-inventory/releases/download/v0.9.7/CainiaoWarehouse-Setup-0.9.7-x64.exe) · [发布附件与校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.9.7)

- 精简设置页，移除应用内使用说明，合并维护状态、版本及在线更新；底部提供官网、GitHub 仓库与更新记录入口。
- 支持钉钉、飞书、企业微信、SMTP 邮箱及 Telegram 多渠道同时发送，同一渠道失败不会被误报为全部成功。配置方式见[通知渠道](notifications.md)。
- 库存仅来源日期偏旧、其他校验通过时，显示特殊发送按钮。弹窗列明期望日期、实际日期及数据风险，二次确认后发送带“日期异常”标记的报告；不导入异常库存，不将正常同步标记为成功。见[特殊发送](date-exception-send.md)。
- 保持独立的程序目录、数据目录、快捷方式与卸载项，支持从独立版 0.9.6 升级。

安装器大小：130,956,649 字节。SHA-256：`ef82cbeb11fa29a036093579b9b4355a5f9b3f27e4c0cc9bfef7e37d38b41bc6`。构建提交：`3f724d917d89af3521c6372e8779b023cd804be8`。

163 项回归测试和打包后的四页面、多渠道配置加密重载、日期异常确认发送测试通过。[Windows CI](https://github.com/907609732/cainiao-inventory/actions/runs/41337397066) 通过。[安装共存验收](https://github.com/907609732/cainiao-inventory/actions/runs/41337977693) 两条路径均通过：全新安装及从 0.9.6 升级，均完成重复安装、两款软件同时启动、卸载云仓及重新打开工作台。工作台程序摘要、快捷方式、卸载项与测试数据绑定保持不变；升级路径保留虚构测试文件。详见附件 `release-validation.json`。

本次验证使用虚构数据及本地模拟消息接收端，不使用用户账本，不向真实通知渠道发送消息。安装器未作 Authenticode 签名。
