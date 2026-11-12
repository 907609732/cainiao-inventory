# 菜鸟云仓 · 飞牛 fnOS

**简体中文（默认）** | [English](README.en.md) · [返回首页](../../README.md)

当前正式版 **0.10.5**，适用于 **x86-64 飞牛 fnOS + Docker**。应用 ID 为 `cainiao-warehouse`，与 ERP 独立部署。界面、浏览器采集和定时任务在 NAS 后台运行，Windows 客户端无需保持开启。

[下载正式安装包、镜像及校验文件](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.5)

## 安装与升级

1. 下载配套的 `cainiao-warehouse-0.10.5-x86.fpk`、`cainiao-warehouse-0.10.5-image.tar.gz` 和 `SHA256SUMS.txt`，核对文件 SHA-256。不能混用其他版本镜像。
2. 在飞牛 Docker 中导入该镜像。命令行可用 `docker load --input cainiao-warehouse-0.10.5-image.tar.gz`；如果图形界面只接受 `.tar`，先将 `.tar.gz` 解压为 `.tar` 再导入。
3. 确认网页端口 `18761`、宿主回环 API 端口 `18762` 未被其他服务占用。不要停止其他服务来腾出端口，应先核查冲突。
4. 在应用中心手动安装 FPK；已有菜鸟云仓时选择更新，保留原应用数据目录。升级前先做完整离线备份。
5. 在向导中确认访问地址。额外域名填写完整 `https://` 或 `http://` 地址，不带路径；多个地址用逗号分隔。升级时留空会保留已有域名配置。
6. 双击飞牛桌面的菜鸟云仓图标，会在内嵌窗口打开。也可通过 `http://<NAS地址>:18761/` 访问。首次配置菜鸟账号、通知渠道及登录态，再按需启用自动任务。

应用不要求新建云仓管理员密码。浏览器保留精确 Host/Origin、会话及 CSRF 校验；请通过可信内网或已有受控飞牛入口访问。域名白名单不会替代飞牛自身的登录认证，也不会自动配置外网代理、DNS 或 TLS。

## 后台任务与通知

- 每日库存任务和每月销量任务首次安装默认关闭，启用后由 NAS 进程执行。NAS、应用及网络必须可用。
- 多渠道可同时启用；保存设置不会发送消息。设置中的小眼睛可按需查看单个已保存密码或密钥。
- Windows 与 NAS 不会自动双向同步数据。为避免相同报告重复发送，同一业务定时任务应只在一个实例启用。
- 先查看任务日志和各渠道受理结果；结果不明时不要重复点击发送。

## 数据与访问边界

| 项目 | 说明 |
| --- | --- |
| 数据目录 | 飞牛为本应用分配的 `TRIM_PKGVAR`，容器内为 `/data` |
| 持久内容 | dataset.json、master.key、secrets.bin、设置、回执、库存/销量库及浏览器登录态 |
| 网页 | LAN 端口 `18761`，支持桌面内嵌窗口及配置的应用域名 |
| 独立 API | 宿主仅绑定 `127.0.0.1:18762`，使用独立凭据；不会自动向 LAN 开放 |
| 可视浏览器 | Xvfb、x11vnc、noVNC 在容器内运行；VNC/noVNC 端口不单独对外暴露，经网关代理 |

容器采用独立 UID/GID、只读根文件系统、`cap_drop: ALL` 和 `no-new-privileges`，不挂载 ERP 目录或 Docker socket。浏览器可写目录位于自己的 `/data/home`。运行时由 tini 回收子进程，Docker 使用 `unless-stopped`；主动停止应用后不应自行启动。健康接口正常不代表菜鸟账号已登录。

不要给容器增加 root 权限或复用 ERP 浏览器目录来绕过安装问题。远端 ERP/AI 调用回环 API 需要独立、经过验证的接入方案。

## 离线备份与恢复

先在应用中心停止本应用，并确认其容器已停止；不停止 ERP。完整备份实际应用数据目录，包括 `dataset.json`、`master.key`、`secrets.bin` 和 `workspace`。备份含登录态与恢复密钥，应存入受限位置并另行加密，不能上传公开仓库。

在具备 Node.js 24 的离线环境，从仓库根目录执行：

```bash
node scripts/fnos-backup.mjs backup /absolute/app/data /absolute/private/backup --service-stopped
node scripts/fnos-backup.mjs restore /absolute/private/backup /absolute/app/data-restored --service-stopped
```

脚本逐文件检查 SHA-256、大小、datasetId 和密钥，拒绝已有目标目录、符号链接及损坏备份。`--service-stopped` 是操作员声明，脚本不会替你停止服务。运行中的 SQLite 文件拷贝不能当作一致备份。

先恢复到新目录，保留原目录用于回滚，核对专用 UID/GID 后再切换。启动后检查 datasetId、配置解密和计划任务。本流程的容器化离线恢复已通过 CI；真实 NAS 的人工目录切换恢复尚未完成端到端验收。

升级只替换本应用镜像和 FPK，保留原 `TRIM_PKGVAR`。不要执行 `docker compose down --volumes`。存在数据格式迁移时，回滚需使用对应旧程序和一致备份，不能只降级程序。

## 卸载

本项目卸载 hook 不主动删除数据、备份、镜像或 ERP 文件。飞牛卸载界面如提供“删除应用数据”，请选择保留，并先核验外部备份；平台自身是否删除私有目录取决于其行为。本项目不能保证覆盖平台删除操作。清理历史镜像和数据应单独确认范围。

## 构建与验收

复用飞牛官方 fnpack、Node.js 24、Docker、Playwright Chromium、Xvfb 和 noVNC；无需在 NAS 系统另装 Node/Python 或桌面服务。依赖许可见 [THIRD-PARTY.md](THIRD-PARTY.md)。

[0.10.5 同提交构建](https://github.com/907609732/cainiao-inventory/actions/runs/43225609303) 已通过容器、四页界面、传输边界、重启与离线恢复检查。此前已在授权 NAS 实际更新到 0.10.5，库存、设置、独立数据集和自动任务保持一致；本次正式产物没有再次部署或触发真实业务发送。

Actions 产物包含 `build.json`、`image-inspect.json` 和构建摘要；正式 Release 提供 FPK、镜像、`SHA256SUMS.txt` 与 `acceptance.json`。[详细部署验收记录](../../docs/fnos-deployment.md)保留历史过程，早期未完成项以最后对应版本的记录为准。
