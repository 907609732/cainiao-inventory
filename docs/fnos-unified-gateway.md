# 飞牛统一网关接入（独立云仓）

本文记录独立菜鸟云仓接入飞牛 fnOS 官方统一网关的实现边界。协议依据官方文档 `统一网关`：应用在 `app/ui/config` 声明 `gatewayPrefix` 与 `gatewaySocket`，网关校验登录态后把请求转发到应用 `target` 目录下的 Unix Socket，并附带 `X-Trim-Userid`、`X-Trim-Isadmin`、`X-Trim-Username`。

## 入口与进程

- 飞牛桌面入口：`/app/cainiao-warehouse`，仍以 `iframe` 内嵌打开。
- Socket：`${TRIM_APPDEST}/app.sock`。容器把 `${TRIM_APPDEST}` 挂载为 `/app-target`，服务监听 `/app-target/app.sock`。
- 局域网网页 `18761` 与仅宿主回环的凭据 API `18762` 保持原有监听，不改为只依赖网关。
- 网关是独立私有监听器，与 LAN/API 共用现有 Fastify、会话、CSRF、内部 `local-web` 调度和 `ws` 依赖，没有新增依赖。

## 同源路径

网关请求会先去掉稳定的 `gatewayPrefix`，再交给同一套应用路由：

| 浏览器路径 | 应用内部路径 |
| --- | --- |
| `/app/cainiao-warehouse`、`/app/cainiao-warehouse/` | `/` |
| `/app/cainiao-warehouse/assets/...`、`/shared/...`、`/node_modules/...` | 同名静态资源 |
| `/app/cainiao-warehouse/api/v1/...` | `/api/v1/...`（含事件轮询与任务回执） |
| `/app/cainiao-warehouse/browser/...` | `/browser/...`（noVNC 页面与 WebSocket） |
| `/app/cainiao-warehouse/browser/websockify` | 私有 `127.0.0.1` websockify 上游 |

返回 HTML 时只在该网关响应中注入：

- `<base href="/app/cainiao-warehouse/">`，并把渲染器原有的 `../assets/`、`../../node_modules/`、`../shared/` 改为以该 base 解析的路径；
- 同源 `gateway-bootstrap.js`，向共享浏览器适配器提供 `window.__CAINIAO_GATEWAY_PREFIX__`；
- NAS 专用的 `nas-ui-adapter.js`。

`desktop/renderer/web-adapter.js` 仅在存在该前缀时给 `/api/...` 加上前缀；Windows/Electron 与现有 LAN 网页没有该全局变量，请求路径保持原样，因此向后兼容。

## 安全边界

- **只信任私有 Socket 上的 `X-Trim-*`**。网关监听器要求存在有效 `X-Trim-Userid`，所有已登录飞牛账号均可访问共享云仓，缺失身份返回 `401 GATEWAY_IDENTITY_REQUIRED`。
- **TCP 拒绝伪造**。`18761` 与 `18762` 的 `onRequest` 一旦看到任何 `x-trim-*` 请求头直接返回 `403 GATEWAY_HEADERS_FORBIDDEN`，避免把客户端头误当网关注入。
- **私有 Socket 使用严格同源校验，而不是旧的 TCP 白名单**。网关可能由飞牛在任意真实访问域名/端口下转发（例如 `https://设备.fnos.net` 或 `http://192.168.1.100:5666`），因此私有监听器只接受语法严格的 Host（URL 可解析、无 userinfo/路径/空白/分隔符），并从 `Origin` 推导精确 origin；`Origin` 必须与 Host 的主机名一致；Host 保留端口时还必须匹配端口。真实 fnOS 1.2.0604 的 Unix 转发会去掉 Host 的外部端口（例如 Host 为 `192.168.1.100`，Origin 为 `http://192.168.1.100:5666`），因此只在这个已认证的私有监听上允许 Origin 补回端口；Origin 存在时使用浏览器的外部 HTTP/HTTPS 协议，不把内部转发的 `X-Forwarded-Proto` 与外部 TLS 协议混为一谈。没有 Origin 的请求优先使用 `X-Forwarded-Proto`（仅私有 Socket 信任，且只接受 `http`/`https`）；否则回环/非 443 端口按 HTTP、其余按 HTTPS 处理，因此真实内网 HTTP 入口也能建立会话。拒绝 `Origin: null`、跨站 `Sec-Fetch-Site` 和 Host/Origin 不一致。LAN `18761`、API `18762` 仍使用原来的固定 origin 白名单，不放宽。
- `getLocalAccess` 与 `openWeb` 返回的 origin/url 包含 `/app/cainiao-warehouse` 前缀，浏览器不会跳出网关命名空间。
- **会话与 CSRF 保留**。网关为已登录账号创建独立 cookie（`nas_gateway_session`，`Path=/app/cainiao-warehouse`），与 LAN 的 `nas_session` 隔离；写操作继续要求 `X-CSRF-Token`，由内部 `local-web` 再次校验 bridge 上下文和幂等键。
- **WebSocket 同样校验身份与来源**。仅开放前缀下的 `/browser/websockify`，要求有效用户身份 Header、同源 Origin 和同一 UID 的网关会话；连接建立后绑定该 UID，不读取消息内的用户 ID。
- **路径规范化**。去掉前缀后拒绝 `//`、反斜杠、空字节和编码后的 `.`/`..` 段，静态文件仍只来自既有白名单。

## Socket 生命周期

- 启动前检查目标路径：
  - 普通文件/非 Socket：拒绝启动，不删除；
  - 已有 Socket 且可连接：拒绝启动，避免抢占；
  - 陈旧 Socket：删除后重建。
- 监听成功后把 Socket 权限收紧为 `0600`，记录设备号/inode；停止时只删除仍属于本进程创建的 Socket。
- `${TRIM_APPDEST}` 必须以 `TRIM_UID`/`TRIM_GID` 可写方式挂载；`entrypoint.sh` 在启动前检查目录存在且可写，否则以明确错误退出，不尝试提权或改写宿主权限。
- `SIGTERM`/`SIGINT` 会关闭 Fastify 监听器、终止浏览器 WebSocket、移除自己的 Socket；容器重启后残留 Socket 由下一次启动的陈旧检查处理。
- `entrypoint.sh` 在配置了 `CAINIAO_GATEWAY_SOCKET` 时等待 Socket 就绪，未就绪则使容器启动失败。

## 回归测试

定向命令：

```powershell
node --test tests/nas-package.test.mjs
cd windows/workbench
node --test tests/nas-gateway.test.mjs tests/local-web-adapter.test.mjs tests/nas-transport.test.mjs tests/nas-runtime.test.mjs
```

覆盖：

- 前缀下的 HTML、静态资源、会话、事件、API 调度及重定向；
- 前缀注入的适配器路径（Windows/LAN 无前缀路径不变）；
- 私有 Socket 身份、缺失身份、普通账号访问、错误 Host/Origin；
- TCP 上的 `X-Trim-*` 伪造拒绝；
- 浏览器 HTTP + WebSocket 同源路径、无身份/错误 Origin/`Origin: null`/WS 无 Origin 拒绝；
- POSIX Socket 陈旧清理、活 Socket 拒绝、非 Socket 文件保留、停止时只删自有 inode。

Windows 本机无法创建文件系统 Unix Socket，socket 文件用例在 Windows 跳过；同一私有监听代码通过 Windows 命名管道执行前缀/身份/WS 用例。完整 Linux/FPK 容器验收仍需在真实飞牛环境完成。

## 已知限制

- 私有网关不依赖安装向导的 origin 白名单，但 Host 必须语法有效且与 `Origin` 同源；非法 Host、`Origin: null` 或跨站请求仍会被拒绝。
- 所有已登录飞牛账号均可使用共享云仓设置、库存、任务和浏览器；网关会话仍按 UID 隔离。
- 仅代理应用已有的 noVNC `/browser/websockify`；没有额外的通用业务 WebSocket 端点。
- 不修改 ERP、真实数据、定时任务或通知配置；测试中的通知/采集均为桩，不联系真实 NAS 或服务商。
