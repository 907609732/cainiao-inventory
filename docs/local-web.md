# 本机网页与 AI 接口（0.9.8 开发版）

应用窗口、浏览器和 AI 共用一个 Electron 后台、一份独立云仓数据以及现有任务锁。网页只在本机运行，后台需要保持开启。此功能尚未替换已发布及本机已安装的 0.9.7。

## 启动

支持该功能的安装包提供“菜鸟云仓”和“菜鸟云仓（网页版）”两个开始菜单入口；也可在设置中点击“打开网页版”。同一配置目录重复启动会复用后台。

源码入口：`npm run dev` 打开应用，`npm run web` 打开浏览器。开发测试必须提供独立 profile，避免使用正式数据，例如：

```powershell
npm --prefix windows/workbench run web -- --user-data-dir=C:\Temp\CainiaoWebDemo
```

安装后的命令行入口：

```powershell
CainiaoWarehouse.exe --web
CainiaoWarehouse.exe --background
CainiaoWarehouse.exe --cli inventory
CainiaoWarehouse.exe --cli sales --year=2026 --month=2026-10
```

`--background` 不创建业务窗口，供本机集成使用。关闭应用窗口会隐藏窗口；关闭浏览器也不会退出后台。托盘提供打开应用、打开网页版和退出操作。退出过程中如有业务任务会提示，正在发送报告时需等待完成。未开启的自动任务和开机启动不会被自动开启。

默认地址为 `http://127.0.0.1:17891`，实际地址可在设置查看。端口被其他程序占用时会明确报错，不连接其他程序。用户可通过 `--web-port=端口` 指定端口；测试环境才允许随机端口 0。同一 profile 的后续入口仍使用其已启动后台地址。

直接输入地址不能建立新登录会话。应用打开网页版时会产生一分钟有效的一次性 fragment 凭据，换取 HttpOnly/SameSite 浏览器会话后立即清除地址中的凭据。刷新页面保留会话；后台重启后需从应用重新打开。服务只接受本机地址和同源请求。

## AI 访问

在设置的“本机网页与 AI 访问”中点击生成凭据。默认只读，需明确勾选才允许该凭据执行写入。凭据只在这次操作后显示，切换页面会清空显示；复制到本机 AI 客户端后可随时撤销。磁盘中的凭据校验记录随其他密钥一并使用 Windows safeStorage 加密。

REST 使用 `Authorization: Bearer <凭据>`。不要将凭据放在 URL，也不要把凭据、业务响应或正式账本提交到 GitHub。以下示例从环境变量读取凭据：

```powershell
$origin = 'http://127.0.0.1:17891'
$headers = @{ Authorization = "Bearer $env:CAINIAO_AI_TOKEN" }
Invoke-RestMethod "$origin/api/v1/call/getInventory" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
Invoke-RestMethod "$origin/api/v1/call/getMonthlySales" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"year":"2026","selectedMonth":"2026-10"}'
```

成功响应为 `{ "ok": true, "value": ... }`。错误返回非 2xx 状态及 `{ "ok": false, "error": { "code": "...", "message": "..." } }`，不回传原始请求或密钥。

| POST 调用路径 `/api/v1/call/…` | 输入 | 用途 |
| --- | --- | --- |
| `getInventory` | `{}` | 来源日期、SKU、数量和预警；无穷可售天数表示为 null |
| `getMonthlySales` | year、selectedMonth、scope、seriesMode、sku，可选 | 销量与趋势筛选 |
| `getCapabilities` | `{}` | 版本、启动模式与调用能力 |
| `getState` / `getLogs` | `{}` | 当前任务与脱敏日志 |
| `getAbout` / `getBranding` | `{}` | 软件版本与品牌 |
| `runNow` | `{"confirmed":true}` | 同步库存并发送报告，需要写权限 |
| `refreshLogin` / `stopTask` | `{"confirmed":true}` | 本机登录或中止任务，需要写权限 |
| `syncMonthlySales` | month、confirmed | 采集一个已结束月份 |
| `backfillMonthlySales` | from、to、confirmed | 最多补抓 24 个已结束月份 |
| `previewDateException` | `{}` | 写权限凭据预览日期异常报告，不发送 |
| `sendDateException` | token、confirmed | 二次确认异常报告，继续遵守日期与文件校验 |

所有写入另需 `Idempotency-Key` 请求头。同一次操作重试必须沿用原 key 和原请求内容。长任务返回 `{taskId,status}`，通过 `GET /api/v1/tasks/<taskId>` 查询；任务状态为 running/succeeded/failed/unknown，成功数据在 value 中。失败、断线或结果不明时先核对任务和渠道回执，不创建新 key 盲目重发。普通查询不创建持久化业务快照。

AI 无权读取密钥、修改设置、生成凭据、安装更新或打开任意本机程序。设置修改由已登录的界面完成；浏览器密钥框保持空白表示沿用原值，清除需要显式勾选。软件更新安装需本机原生弹窗确认。

## MCP

继续使用官方 MCP stdio 协议，配置示例中的可执行文件应替换为实际安装位置：

```json
{
  "mcpServers": {
    "cainiao-warehouse": {
      "command": "C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\CainiaoWarehouse\\CainiaoWarehouse.exe",
      "args": ["--mcp-stdio"]
    }
  }
}
```

新增 `inventory_query` 和 `inventory_monthly_sales` 查询工具，保留状态、诊断与显式确认的同步工具。CLI/MCP 自动连接同一后台；没有后台时启动一个无窗口实例，结束 MCP 客户端不会退出共享后台。stdio 由本机进程权限保护，REST 凭据的只读范围只适用于对应 REST 凭据；原有 MCP 副作用工具仍要求明确确认参数。

## 复用与验证

复用 [Fastify](https://github.com/fastify/fastify)、[@fastify/static](https://github.com/fastify/fastify-static)（MIT）和 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)（Apache-2.0），保留原库存、销量、通知和 Windows 密钥存储。静态资源仅映射明确列出的 UI 文件及 ECharts/Grid.js 发布资源，不公开项目根目录、node_modules 目录、设置或数据库。

依赖审计发现初选静态插件 8.x 的路径处理已有修复，因此实际锁定支持 Fastify 5 的 10.1.10，并使用 Fastify 5.12.7。没有执行扩大范围的自动依赖升级。

专项验收使用临时 profile、虚构商品和本地模拟消息端，覆盖双入口、同一后台、库存/销量/设置一致、只读 AI、撤销凭据、失败回执、断线不重发、身份校验与退出清理。未使用正式数据，未验证真实通知渠道送达。打包与隔离安装结果见实施计划的最终验收记录。
