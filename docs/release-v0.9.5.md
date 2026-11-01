# 菜鸟云仓 0.9.5：修复工作台覆盖问题

[Windows x64 安装器](https://github.com/907609732/cainiao-inventory/releases/download/v0.9.5/CainiaoWarehouse-Setup-0.9.5-x64.exe) · [Releases](https://github.com/907609732/cainiao-inventory/releases)

0.9.3、0.9.4 错误地复用了电商工作台的应用标识、安装目录和默认数据位置，现已撤回。0.9.5 使用独立身份：

- 应用标识：`com.wucheng.cainiao.warehouse`。
- 主程序：`CainiaoWarehouse.exe`，默认安装于 `%LOCALAPPDATA%\Programs\CainiaoWarehouse`。
- 默认数据：`%APPDATA%\cainiao-cloud-warehouse`；独立注册表位于该目录的 `integrations/registry.json`。
- 独立快捷方式、卸载登记、启动项及更新缓存。
- 普通启动忽略工作台的位置记录和继承的工作台注册表参数；只有显式托管组件保留宿主绑定能力。

## 测试

140 项回归测试、独立源码和打包界面、Windows CI 通过。Sandbox 内先安装真实工作台 0.11.4，再安装及重复安装云仓，核对工作台程序摘要、快捷方式、卸载项、注册表与数据位置记录；卸载云仓后重新打开工作台，全部通过。本机修复后两款软件同时运行，工作台文件与数据绑定摘要不变。

原版本仅做全新安装测试，未覆盖共存情形，本次已补充该回归场景。测试记录见 Release 附件 `release-validation.json`。

大小：130,697,204 字节。SHA-256：

```text
1a9b447b1ae52938638a20fb12a7c3df0b2058ca13ce6c23511af95aa08f442f
```

构建提交：`4054e81171f285a55dfe786d3d6c6fc02ac09ba7`。未测试真实平台采集 / 投递或业务账本迁移；安装器无 Authenticode 签名。

## 已安装旧版本时

不要直接卸载发生覆盖的旧版本，其卸载项与工作台重合。先备份配置、位置记录及账本，恢复工作台程序并保留既有组件，随后安装独立云仓。0.9.5 不会自动搬入工作台账本或登录资料。
