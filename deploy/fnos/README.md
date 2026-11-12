# 独立菜鸟云仓 fnOS 包

应用 ID `cainiao-warehouse`，NAS 版本 `0.10.0`（Windows 版本保持原样）。目标 x86-64 fnOS + 已启用 Docker。当前文件为实施方案；必须等 GitHub 同次构建和真实 NAS 验收后才算可安装交付。

## 构建与安装

GitHub `Independent fnOS package` 工作流生成一个私有 Actions artifact，含 `.fpk`、压缩 Docker image tar、SHA256SUMS、build.json（同次 commit/run）与 image-inspect.json；不推送镜像仓库、不发布 Release。镜像使用 Node24 + lockfile 对应 Chromium，完整 Linux 依赖均在镜像内，无需 NAS 系统安装 Node/Python/X 服务。

1. 下载同一次 run 的完整 artifact，在暂存目录执行 `sha256sum --check SHA256SUMS`，核对 build.json 中 commit/run 与预期一致。
2. 以 NAS 已授权管理员执行 `docker load --input cainiao-warehouse-0.10.0-image.tar.gz`。只导入此应用镜像，不接管其他容器。
3. 检查 `ss -ltn` 确认 18761、18762 未占用。fnOS 只替本应用检查主端口；API 端口须单独核对。
4. 在 fnOS 应用中心手动安装同次 `.fpk`。fnOS Docker 项目资源负责启动、停止；首次由包用户创建自己的 `TRIM_PKGVAR/data`。镜像导入单独执行，使包账号不获得 root 或 docker 组权限。不要使用来源不明的同名镜像替代。
5. 在安装向导确认实际浏览器访问地址并设置至少16位独立管理员密码，再访问对应地址登录。安装向导通过 fnOS 临时环境变量传递密码，生命周期脚本仅写入私有初始化文件，不记录日志；应用运行时不把密码、API key、会话放入环境变量或 URL。由 NAS runtime 负责首次消费密码后存储哈希；实际是否删除初始化文件须验收确认。

尚未验证 fnOS 实机生命周期及安装 hook 中 TRIM_UID/TRIM_GID 的实际传递；若平台未向 Compose 传递，安装应失败，需在真实设备核查后修正，不能用 root 运行绕过。

## 隔离、浏览器与重启

- 容器使用专用包 UID/GID、只读根文件系统、cap_drop ALL、no-new-privileges。仅挂载自己的 `${TRIM_PKGVAR}/data:/data`。无 ERP 目录、共享浏览器或 docker.sock。
- LAN 只开放 18761 认证网页网关。18762 容器内单独认证 API 绑定 0.0.0.0，宿主仅发布 `127.0.0.1:18762`；远端 ERP 必须通过经过审查的私网通道/代理接入，不自行向 LAN 暴露。旧业务 transport 不对外开放。
- Xvfb `:99` 禁止 TCP，x11vnc5900 与 noVNC6080 仅绑定容器 loopback，由认证网关代理网页和 WebSocket。无独立公网 VNC 端口。私有 VNC 本身不设密码，因为受同一容器和网关边界保护。
- tini 负责子进程回收；任一必要子进程退出将停止整个容器，Docker `unless-stopped` 重启，停止应用后不自行复活。进程仅探测端口健康，不代表业务平台已登录。
- `/data` 保存 dataset.json、master.key、secrets.bin、设置、回执、业务库与浏览器 auth；tmpfs 仅运行临时文件。自动任务的重启行为由 NAS runtime 控制，初次安装默认关闭。

## 离线备份与恢复

完整 `/data` 必须一起备份，尤其 dataset.json、master.key（32 字节）、secrets.bin 与 workspace；缺失 key 拒绝备份。备份包含真实登录态和恢复密钥，应放在管理员受限目录并另行加密保存，不发送到日志/公开仓库。

先在应用中心停止本应用并确认其容器停止（不停止 ERP）。在具有 Node24 的离线环境运行：

```
node scripts/fnos-backup.mjs backup /absolute/app/data /absolute/private/backup --service-stopped
node scripts/fnos-backup.mjs restore /absolute/private/backup /absolute/app/data-restored --service-stopped
```

脚本拒绝已存在的目标目录、symlink 和损坏/新增文件；逐文件 SHA256、大小、datasetId 与 key 检查通过后才原子完成恢复。`--service-stopped` 是操作员声明，不会跨容器代停应用。备份必须在应用停止后运行，不能把运行中的 SQLite 拷贝视为一致备份。

在 NAS 可用同次镜像内的 Node24 离线运行该脚本（只给自己的数据和备份目录挂载，不挂 Docker socket）；恢复到新目录，核对完整性后由管理员把原目录改名保留为回滚，再换入恢复目录并保持专用包 UID/GID。启动后核对 datasetId 不变、解密配置可读、自动任务仍符合 opt-in 规则。此流程尚待真实 NAS 验证。

## 更新与卸载

更新前停止并离线备份；只导入新镜像与安装新 fpk，保持 `TRIM_PKGVAR/data` 原路径。不要执行 `docker compose down --volumes`。回滚需恢复同一备份与对应旧镜像/FPK，不能仅降级有迁移的数据。

卸载 hook 不删除数据、备份、Docker image 或任何 ERP 文件；fnOS 自身卸载界面如提供“删除应用数据”，必须选择保留数据并先验证外部备份。平台卸载是否删除 var 目录必须实机验证；本项目不声称能覆盖平台行为。需要清理历史镜像/数据时由用户单独指定。

依赖与许可见 THIRD-PARTY.md。验收状态和限制汇总到 `docs/fnos-deployment.md`，CI 浏览器探测不等于真实菜鸟登录、业务采集或 NAS 安装成功。
