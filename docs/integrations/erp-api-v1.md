# 独立飞牛云仓与 ERP API v1

状态：实现中；本契约锁定兼容路径，示例均为虚构，尚无已安装服务地址或真实凭据。

## 身份与连接边界

独立应用 ID `cainiao-warehouse`；服务品牌 `cainiao-cloud-warehouse`；协议整数 `1`。数据集首次初始化产生永久随机 UUID `datasetId`，备份恢复保持它，空库重新初始化改变它。`instanceId` 每次服务启动改变。ERP 必须同时核对品牌、协议及其已绑定的 datasetId；不得把其他应用或新空库视作原数据。

网页由独立的认证网关提供，ERP 同机服务端通过单独的 loopback API 入口连接。不对局域网/公网公开原 0.9.8 loopback 服务。ERP 不直接读取云仓数据库，不共享 ERP 登录令牌或数据库。服务端凭据通过 Authorization 头发送，禁止 URL 长期密钥。

固定安装目标：ERP 后台 `apiBaseUrl = http://127.0.0.1:18762`；用户独立网页 `webUrl = http://192.168.1.100:18761/`。这些是实现/安装目标，尚未通过 NAS 实测；若端口冲突将先记录再改变，禁止占用或停止现有应用。容器的 API 端口仅发布到 NAS 主机回环；若 ERP 自身运行在隔离网络命名空间，不能用其容器的 127.0.0.1，需要经双方确认的私网路由，不能扩大为公网 API。网页地址不得使用用户电脑自己的 127.0.0.1。

服务凭据默认只读，独立生成、轮换与撤销；轮换后旧凭据失效。原始凭据只显示一次，不写文档或日志。ERP 应使用服务端密钥存储，不放入浏览器前端。

## 查询

`GET /api/v1/health` 无需凭据，仅包含身份，不包含账号和业务数据：

```json
{"brand":"cainiao-cloud-warehouse","version":"0.10.0","protocol":1,"instanceId":"DEMO-BOOT-ID","datasetId":"00000000-0000-4000-8000-000000000001","platform":"fnos"}
```

以下 POST 均要求 `Authorization: Bearer <服务凭据>` 和 `Content-Type: application/json`，成功封装 `{ "ok": true, "value": ... }`：

| 路径 | 请求体 | 内容 |
| --- | --- | --- |
| `/api/v1/call/getCapabilities` | `{}` | 能力与版本 |
| `/api/v1/call/getInventory` | `{}` | 库存快照、SKU、预警；空库 `available:false,items:[]` |
| `/api/v1/call/getMonthlySales` | `{"year":"2026","selectedMonth":"2026-10"}` | 月销量、趋势；缺失月份不伪装为零 |
| `/api/v1/call/getState` | `{}` | 任务状态、下次执行与登录待处理状态 |
| `/api/v1/call/getLogs` | `{}` | 脱敏运行日志 |

库存示例（字段沿用 0.9.8）：

```json
{"ok":true,"value":{"available":true,"sourceDate":"2026-11-11","skuCount":1,"totalQuantity":123,"items":[{"sku":"DEMO-001","name":"演示商品","quantity":123,"sourceDate":"2026-11-11"}]}}
```

响应可能增加字段；ERP 不应依赖字段顺序。数字没有可定义值时为 null，不使用 Infinity/NaN。错误封装 `{"ok":false,"error":{"code":"READ_ONLY","message":"Read only"}}`。401 重新配置凭据，403 权限/确认不足，409 幂等冲突，503 服务未就绪；禁止自动升级写权限。

## 写入与长任务

兼容 `/api/v1/call/runNow|refreshLogin|stopTask|syncMonthlySales|backfillMonthlySales|previewDateException|sendDateException`。只读凭据不得写入。获得写权限后还需操作专属确认参数、`Idempotency-Key`；同一次用户动作重试复用同键，相同键不同载荷返回 409。

`syncMonthlySales` 示例 `{"month":"2026-10","confirmed":true}`；`backfillMonthlySales` 为 `{"from":"2026-01","to":"2026-10","confirmed":true}`。启动后返回 `{"ok":true,"value":{"taskId":"DEMO-TASK-ID","status":"running"}}`。

`GET /api/v1/tasks/:id` 使用同一服务身份的凭据，仅可读取自身任务。状态 `running|succeeded|failed|unknown`；成功的结果放在 `value.value`。重启时未确认结束的任务标记 unknown，不自动重跑、不盲目补发报告。

日期异常必须先 `previewDateException`，展示具体来源日期问题并由用户二次确认，再将预览令牌作为 `confirmationToken` 提交 `sendDateException`。令牌绑定调用身份、目标配置和文件，过期或改变后不能继续发送。预览权限属于写权限范围，不向默认只读 ERP 凭据暴露报告内容或发送令牌。

## ERP 最小调用（服务端）

```js
const response = await fetch(baseUrl + '/api/v1/call/getInventory', {
  method: 'POST',
  headers: {'Content-Type':'application/json', Authorization:'Bearer ' + credential},
  body: '{}', signal: AbortSignal.timeout(10000), redirect: 'error'
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.error?.code || 'WAREHOUSE_UNAVAILABLE');
```

接口超时不代表写入未发生。ERP 保存 taskId 和幂等键，优先查回执；记录 unknown 并等待人工核查，不将网络失败改写为发送失败。
