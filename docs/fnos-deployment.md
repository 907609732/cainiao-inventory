# 独立飞牛应用部署记录

当前阶段：独立服务与 GitHub Linux/Windows 验证已通过，同次镜像已导入 NAS；FPK 已载入应用中心，正在“未经验证应用”的责任确认提示处交给用户，尚未安装/上线。

## 已授权范围

独立云仓应用、独立空配置和空业务库，API 连接 ERP，保留 Windows。不得修改 ERP 工作树、正式 ERP/账本、共享浏览器或其他任务；不包含订单导出，不迁移 Windows 密钥或历史数据，不发布公开 Release。自动任务默认关闭，未授权真实通知测试。

## 环境与阻碍（2026-11-12）

- 本地 Node、OpenSSH 可用；未发现 Docker/fnpack 命令。
- NAS `192.168.1.100` SSH 可达；既有部署密钥以 root 登录返回 Permission denied，未修改服务器权限。
- NAS 管理入口 `http://192.168.1.100:5666/`；当前会话和安装权限需重新确认。
- 当前 Windows 版本 0.9.8；开发分支 `codex/fnos-standalone`。
- `E:\WuchengBuilds\fnos-ci-repair` 和现有 ERP 共享浏览器均不属于本任务。
- 在独立 Chrome 检查页实查：飞牛已有认证会话；Docker 服务健康，3 个项目和 3 个容器运行，Docker 开机启动已启用；Docker 位于存储空间 4，其界面显示约 111.63/407.48 GB 已用。未停止或修改这些容器。
- 计划网页 `http://192.168.1.100:18761/`，ERP 服务端 API `http://127.0.0.1:18762`；未确认安装前端口空闲，尚无真实 datasetId。与 ERP 共享浏览器端口无关。
- 本地 NAS 网页集成测试通过：完整四页面、空数据集、虚构账号保存与刷新、密钥不回传、ERP 只读查询；运行 `node windows/workbench/tests/nas-ui.mjs`。这不代表 Linux/NAS 或真实菜鸟采集已通过。
- 定向传输与原 Windows 传输测试 10 项通过；noVNC 测试使用 HTTP/WS 测试端点验证鉴权，未代替真实 NAS 浏览器验收。
- 最新本地完整回归：215 项中 214 通过、0 失败、1 个 Linux 专属用例在 Windows 跳过；另有独立包装/备份测试 2 项通过、1 个 Linux 用例跳过。完整日志保留在本机临时验证记录，不能把跳过项算作通过。
- 现有 Linux CI 构建已确认依赖安装和 Chromium/SQLite 可用，容器内四页面与认证 API 测试已执行通过。首轮 `/data` 已存在导致构建失败，后续已改为幂等建目录；有头 Chrome 在只读容器中的 Crashpad 目录问题已通过显式私有 XDG 目录修补，待当前运行实证。
- 当前最终代码验收运行：[Linux/FPK 43154172899](https://github.com/907609732/cainiao-inventory/actions/runs/43154172899)、[Windows 43154172871](https://github.com/907609732/cainiao-inventory/actions/runs/43154172871)，构建提交 `30c59c55941abdb9b7c36184c1b820bddd034ac7`。

## 安装操作边界

### 同次构建与当前安装材料

- [Linux/FPK 43154770695](https://github.com/907609732/cainiao-inventory/actions/runs/43154770695) 成功，源码提交 `178dbaaeae54d84baaaecc472f6becdeb5dae187`；同提交 Windows CI `43154770637` 完成。
- 该运行实际通过容器内四页面、认证 API、非 root Chromium/SQLite、有头 Xvfb、正常重启、SIGKILL 后自动恢复、不同 UID 启动及离线备份恢复。
- 下载目录：`C:\Users\90760\Documents\Codex\cainiao-fnos-0.10.0-43154770695\dist\fnos`。
- FPK `cainiao-warehouse-0.10.0-x86.fpk`，146895 字节，SHA256 `ef48c1be01efd2aaddd5ab6bea0d1d929c83f6046126ec5ee63bb81cee942922`。
- 压缩镜像 `cainiao-warehouse-0.10.0-image.tar.gz`，672655181 字节，SHA256 `53334d10dc32f5dfbaeddc84b64fb29b86eec660d71dce083cb3ea73a98e0f08`。
- 飞牛 GUI 的镜像选择器实际禁选 `.tar.gz`。将上述同次归档用标准 gzip 解压为 `.tar`（内容不修改），1733318656 字节，SHA256 `3693d27e023427e97712aa55d9f12f0127e177c574c26307b4342080c23c7dfe`，供 GUI 导入。
- NAS 安装文件位置：我的文件/`cainiao-warehouse-install-20261112`（存储空间 2，UI 显示内部相对路径 `vol2/1000/cainiao-warehouse-install-20261112`）。未改动并列 ERP 文件夹。压缩镜像、FPK 和摘要上传成功；未压缩 TAR 正在追加上传。
- 未压缩 TAR 也已上传完成；Docker 本地镜像实查出现 `cainiao-warehouse:0.10.0`，1.59 GB，镜像数量从 6 增至 7，未替换原镜像。
- FPK 由应用中心“手动安装/从电脑上传”载入，选择默认软件存储空间 4。当前弹窗为“未经验证应用的安全提示”，含设备损坏/数据丢失责任确认；尚未点击“同意”。用户随后已接受许可，安装停在密码设置步骤。浏览器标签页 `59548322`（Chrome browser 4）已保留供用户操作。
- 当前应用服务并未启动，因此尚无可填写的真实 datasetId；不能把 CI 测试身份登记为 NAS 身份。真实菜鸟登录、采集、ERP 实际联调、NAS 安装后生命周期及物理重启均未完成。

同次产物包含镜像 tar、独立 FPK 和 SHA256SUMS。通过已有飞牛 Docker“从 NAS 文件添加”导入镜像，再在应用中心安装 FPK；不授予应用 Docker socket 或宿主 root。先检查 18761/18762 空闲，占用时直接拒绝，不终止现有服务。

用户明确要求免管理员密码：0.10.1 移除安装密码字段，网页直接访问，保留 Host/Origin、会话和 CSRF 校验；ERP API 仍使用独立凭据。旧认证文件和其他数据不迁移、不重置。首次菜鸟登录可不预存账号密码，由独立可视化浏览器手动处理；真实验证码由用户完成。

CLI 显式 `collect-only --confirm-collect` 可执行真实采集、校验、入库并将通知状态记录为 skipped，不创建发送报告或联系通知渠道。普通“立即同步并发送”仍要求已启用有效渠道，不能隐式转为仅采集。

## 验收清单

- [ ] 云仓 Node 服务在 Linux 运行，无 Electron/Windows 加密依赖。
- [ ] 完整四页面与全部原有操作，空库空配置和默认关闭自动任务。
- [ ] ERP 只读凭据/撤销/身份校验/幂等长任务契约。
- [ ] 可视化菜鸟登录及真实平台连接（无授权不发送通知）。
- [ ] 独立 fpk/服务身份/端口/数据与卸载边界。
- [ ] GitHub 检查、同次产物下载校验。
- [ ] NAS 隔离安装、重启恢复、备份恢复、故障恢复、浏览器访问。

## 接口

参见 [ERP API v1](integrations/erp-api-v1.md)。最终访问地址、datasetId、安装包校验值及逐项证据将在实际验收后填写，不能以本地或 CI 模拟替代。

## 0.10.1 免密码调整（进行中）

复用现有 Fastify 网关和会话机制，不新增依赖。主进程显式使用直接网页访问模式；凭据 API、私有 CLI owner、ERP 只读权限继续隔离。针对性传输测试与四页 UI 实测通过，待同次 GitHub 构建和 NAS 安装验收。

## 2026-11-12 免密码安装与真实 NAS 故障定位

- 用户明确取消独立云仓管理员密码；0.10.1 安装向导已无密码字段，主服务采用直接网页访问，ERP API 独立凭据不变。原 Windows 版本不受影响。
- 3f90945 构建 43157910381 与 Windows CI 均通过；25 项针对性测试中 23 通过、2 Linux 本地跳过，真实四页浏览器测试通过。NAS 导入镜像 `cainiao-warehouse:0.10.1` 成功，FPK 安装失败，服务端口尚未启动。
- 诊断构建 43159207305 通过；NAS 重现明确报错 `private-data-directory (exit 1)`。对照 fnOS 安装阶段及同类开源项目记录，install_init 早于私有数据目录准备，不能在此创建持久数据子目录。
- f15722b 修复：install_init 仅验证端口与向导；install_callback 在私有目录创建后写入 public-origin；容器仅挂载 `${TRIM_PKGVAR}:/data`，保持非 root、私有目录与 ERP 隔离。尚无此前安装成功的数据，因此没有执行存量路径迁移。此后配置/升级脚本使用同一目录。
- 修正 FPK 已从 GitHub run 43160211642 下载到 `C:\Users\90760\Documents\Codex\cainiao-fnos-fixed-43160211642`，待真实安装；同次容器测试已通过，整个工作流仍在收尾。
- NAS 后台在等待期间返回登录页面；已请用户重新登录原有 NAS 账号，未要求新建密码。无需云仓管理员密码。当前不能声称安装或业务采集验收完成。
- 未停止/重建原有 `jx-frpc`、`qwrt`、`homeassistant` 容器，未操作 ERP 安装目录和历史数据库。未迁移历史数据、未发送真实通知。
- 后续备份源应为本应用实际 `TRIM_PKGVAR`，不再额外拼接 `/data`；此前 0.10.0 未完成安装。
