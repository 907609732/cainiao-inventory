import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import path from "node:path";
import { readJson } from "./files.js";
import type { CainiaoInventoryAutomation } from "./automation.js";
import type { AutomationConfig, ReportPolicy } from "./types.js";

const execFileAsync = promisify(execFile);

export interface SetupServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startSetupServer(automation: CainiaoInventoryAutomation, options: {
  pluginRoot?: string;
  autoOpen?: boolean;
  idleMs?: number;
} = {}): Promise<SetupServerHandle> {
  const token = crypto.randomBytes(24).toString("base64url");
  const pluginRoot = options.pluginRoot || process.env.CAINIAO_PLUGIN_ROOT || "";
  let idleTimer: NodeJS.Timeout;
  const server = http.createServer(async (request, response) => {
    resetIdle();
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/") return html(response, SETUP_HTML);
      if (request.headers["x-setup-token"] !== token) return json(response, 403, { ok: false, error: "invalid_setup_token" });
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(response, 200, {
          ok: true,
          doctor: await automation.doctor(),
          status: await automation.getStatus(),
          config: redactConfig(automation.config()),
          state: readJson<Record<string, unknown>>(automation.paths.state, {})
        });
      }
      if (request.method !== "POST") return json(response, 404, { ok: false, error: "not_found" });
      const body = await readBody(request);
      if (url.pathname === "/api/runtime") {
        if (!pluginRoot) throw new Error("无法确定插件目录，不能准备运行时。");
        const script = path.join(pluginRoot, "scripts", "install-runtime.sh");
        const { stdout } = await execFileAsync("/bin/bash", [script], {
          env: { ...process.env, CAINIAO_APP_ROOT: automation.paths.root, CAINIAO_PLUGIN_ROOT: pluginRoot },
          timeout: 15 * 60_000,
          maxBuffer: 4 * 1024 * 1024
        });
        return json(response, 200, { ok: true, message: stdout.trim() });
      }
      if (url.pathname === "/api/config") {
        const reportPolicy = body.reportPolicy as ReportPolicy;
        if (!["always", "critical_only"].includes(reportPolicy)) throw new Error("请选择日报策略。");
        const config = automation.configure({
          reportPolicy,
          callback: { enabled: Boolean(body.callbackEnabled) },
          schedule: {
            ...automation.config().schedule,
            hour: integer(body.hour, 22),
            minute: integer(body.minute, 0),
            catchUpHours: integer(body.catchUpHours, 24)
          }
        });
        return json(response, 200, { ok: true, config: redactConfig(config) });
      }
      if (url.pathname === "/api/secrets") {
        await automation.setSecrets({
          dingtalkWebhook: string(body.dingtalkWebhook),
          dingtalkSecret: string(body.dingtalkSecret),
          callbackUrl: string(body.callbackUrl),
          callbackToken: string(body.callbackToken)
        });
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/api/login") return json(response, 200, { ok: true, result: await automation.login() });
      if (url.pathname === "/api/test-dingtalk") return json(response, 200, { ok: true, result: await automation.testDingTalk() });
      if (url.pathname === "/api/dry-run") {
        const result = await automation.runInventory({ mode: "validate_only" });
        return json(response, result.status === "succeeded" ? 200 : 422, { ok: result.status === "succeeded", result });
      }
      if (url.pathname === "/api/schedule") {
        const state = readJson<Record<string, unknown>>(automation.paths.state, {});
        if (!state.dingtalkTestAt) throw new Error("请先完成钉钉测试。");
        if (!state.dryRunValidatedAt || state.dryRunSource !== "browser") throw new Error("请先完成真实抓取 dry-run。");
        const schedule = automation.installSchedule();
        return json(response, 200, { ok: true, schedule });
      }
      if (url.pathname === "/api/schedule-remove") {
        automation.removeSchedule();
        return json(response, 200, { ok: true });
      }
      return json(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("设置向导端口分配失败。");
  const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
  resetIdle();
  if (options.autoOpen !== false && process.platform === "darwin") {
    const child = spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  }
  return {
    url,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };

  function resetIdle(): void {
    clearTimeout(idleTimer!);
    idleTimer = setTimeout(() => server.close(), options.idleMs ?? 20 * 60_000);
    idleTimer.unref();
  }
}

function redactConfig(config: AutomationConfig): AutomationConfig {
  return JSON.parse(JSON.stringify(config)) as AutomationConfig;
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 64 * 1024) throw new Error("请求体过大。");
    chunks.push(value);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function html(response: http.ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function string(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function integer(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : fallback; }

const SETUP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>菜鸟库存自动化设置</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202724; background: #f4f6f5; }
    * { box-sizing: border-box; letter-spacing: 0; }
    body { margin: 0; min-height: 100vh; }
    header { background: #173d2d; color: white; padding: 24px max(24px, calc((100vw - 920px) / 2)); }
    h1 { margin: 0; font-size: 26px; font-weight: 700; }
    header p { margin: 7px 0 0; color: #d7e6df; }
    main { width: min(920px, calc(100% - 32px)); margin: 24px auto 48px; }
    section { border-top: 1px solid #cbd3cf; padding: 20px 0; display: grid; grid-template-columns: 180px 1fr; gap: 24px; }
    h2 { margin: 0; font-size: 17px; }
    p { line-height: 1.55; }
    .controls { display: grid; gap: 12px; min-width: 0; }
    .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
    input, select { width: 100%; min-height: 40px; border: 1px solid #9aa7a0; background: white; color: #202724; padding: 8px 10px; font: inherit; border-radius: 4px; }
    button { justify-self: start; min-height: 40px; border: 1px solid #173d2d; background: #173d2d; color: white; padding: 8px 16px; font: inherit; font-weight: 650; border-radius: 4px; cursor: pointer; }
    button.secondary { background: white; color: #173d2d; }
    button:disabled { opacity: .55; cursor: wait; }
    pre { margin: 0; background: #202724; color: #e9f1ed; padding: 14px; border-radius: 4px; overflow: auto; min-height: 68px; max-height: 280px; white-space: pre-wrap; font-size: 12px; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge { border: 1px solid #9aa7a0; background: white; padding: 4px 8px; border-radius: 3px; font-size: 12px; }
    .ok { border-color: #2f7d55; color: #1f6342; }
    .bad { border-color: #b8463f; color: #9d2d27; }
    @media (max-width: 700px) { section { grid-template-columns: 1fr; gap: 10px; } .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header><h1>菜鸟库存自动化</h1><p>完成检查后再启用每天 22:00 的库存任务。</p></header>
  <main>
    <section><h2>环境体检</h2><div class="controls"><div id="checks" class="status"></div><button data-action="refresh">重新检查</button></div></section>
    <section><h2>运行环境</h2><div class="controls"><p>准备隔离的 Node、Playwright 和 Chromium。</p><button data-action="runtime">准备运行环境</button></div></section>
    <section><h2>菜鸟登录</h2><div class="controls"><p>浏览器打开后完成一次登录、滑块或短信验证。</p><button data-action="login">打开登录窗口</button></div></section>
    <section><h2>钉钉</h2><div class="controls"><label>Webhook<input id="webhook" type="password" autocomplete="off"></label><label>加签 Secret，可留空<input id="secret" type="password" autocomplete="off"></label><div><button data-action="secrets">保存到 Keychain</button> <button class="secondary" data-action="test">发送连接测试</button></div></div></section>
    <section><h2>日报设置</h2><div class="controls"><div class="row"><label>发送策略<select id="policy"><option value="">请选择</option><option value="always">每天发送摘要</option><option value="critical_only">仅严重预警时发送</option></select></label><label>中国时间小时<input id="hour" type="number" min="0" max="23" value="22"></label><label>分钟<input id="minute" type="number" min="0" max="59" value="0"></label><label>补跑窗口（小时）<input id="catchUp" type="number" min="0" max="168" value="24"></label></div><label><span>可选回调 URL</span><input id="callbackUrl" type="password" autocomplete="off"></label><label>回调 HMAC Token<input id="callbackToken" type="password" autocomplete="off"></label><button data-action="config">保存设置</button></div></section>
    <section><h2>真实验收</h2><div class="controls"><p>抓取真实 Excel 并验真，不发送业务报告。</p><button data-action="dry">运行 dry-run</button></div></section>
    <section><h2>每日任务</h2><div class="controls"><p>只有钉钉测试和 dry-run 都成功后才能启用。</p><div><button data-action="schedule">启用定时任务</button> <button class="secondary" data-action="unschedule">停用</button></div></div></section>
    <section><h2>执行结果</h2><pre id="output">等待操作...</pre></section>
  </main>
  <script>
    const token = new URLSearchParams(location.search).get('token') || '';
    const output = document.querySelector('#output');
    async function call(path, body) {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-setup-token': token }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      output.textContent = JSON.stringify(data, null, 2);
      if (!response.ok || !data.ok) throw new Error(data.error || '操作失败');
      return data;
    }
    async function refresh() {
      const data = await call('/api/status');
      const checks = document.querySelector('#checks');
      checks.innerHTML = '';
      for (const check of data.doctor.checks) { const node = document.createElement('span'); node.className = 'badge ' + (check.ok ? 'ok' : 'bad'); node.textContent = check.message; checks.appendChild(node); }
      if (data.config.reportPolicy) document.querySelector('#policy').value = data.config.reportPolicy;
      document.querySelector('#hour').value = data.config.schedule.hour;
      document.querySelector('#minute').value = data.config.schedule.minute;
      document.querySelector('#catchUp').value = data.config.schedule.catchUpHours;
    }
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]'); if (!button) return;
      button.disabled = true;
      try {
        const action = button.dataset.action;
        if (action === 'refresh') await refresh();
        if (action === 'runtime') await call('/api/runtime', {});
        if (action === 'login') await call('/api/login', {});
        if (action === 'secrets') await call('/api/secrets', { dingtalkWebhook: webhook.value, dingtalkSecret: secret.value, callbackUrl: callbackUrl.value, callbackToken: callbackToken.value });
        if (action === 'test') await call('/api/test-dingtalk', {});
        if (action === 'config') await call('/api/config', { reportPolicy: policy.value, hour: Number(hour.value), minute: Number(minute.value), catchUpHours: Number(catchUp.value), callbackEnabled: Boolean(callbackUrl.value) });
        if (action === 'dry') await call('/api/dry-run', {});
        if (action === 'schedule') await call('/api/schedule', {});
        if (action === 'unschedule') await call('/api/schedule-remove', {});
        await refresh();
      } catch (error) { output.textContent += '\n\n' + error.message; } finally { button.disabled = false; }
    });
    refresh().catch((error) => output.textContent = error.message);
  </script>
</body>
</html>`;
