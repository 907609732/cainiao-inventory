import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BrowserWorkerRequest, BrowserWorkerResult } from "./types.js";
import { findInventoryExportButton, prepareDefaultInventoryView } from "./browser-page.js";

const TARGET_URL = "https://b.cainiao.com/business/dsc/oms/inventory/inventoryreport";
let currentStage = "启动浏览器";

async function main(): Promise<void> {
  const request = JSON.parse(process.env.CAINIAO_BROWSER_REQUEST || "{}") as BrowserWorkerRequest;
  if (!request.action || !request.profileDir || !request.storageStateFile || !request.diagnosticsDir) throw new Error("浏览器请求参数不完整。");
  fs.mkdirSync(request.profileDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(request.diagnosticsDir, { recursive: true, mode: 0o700 });
  if (request.outputDir) fs.mkdirSync(request.outputDir, { recursive: true, mode: 0o700 });

  const context = await chromium.launchPersistentContext(request.profileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-save-password-bubble",
      "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  try {
    markStage("恢复认证状态");
    await restoreStorageState(context, request.storageStateFile);
    const page = context.pages()[0] || await context.newPage();
    const action = request.action === "login" ? login(context, page) : exportInventory(context, page, request);
    const result = request.action === "export"
      ? await withTimeout(action, 180_000, "浏览器任务超过 180 秒总上限")
      : await action;
    markStage("刷新认证状态");
    if (result.ok && result.loggedIn) await saveStorageState(context, request.storageStateFile);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    await captureDiagnostic(context.pages()[0], request.diagnosticsDir, request.action);
    const result: BrowserWorkerResult = {
      ok: false,
      action: request.action,
      loggedIn: false,
      stage: currentStage,
      message: `${currentStage}：${error instanceof Error ? error.message : String(error)}`
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  } finally {
    await Promise.race([context.close(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
}

async function restoreStorageState(context: BrowserContext, file: string): Promise<void> {
  if (!fs.existsSync(file)) return;
  let state: {
    cookies?: Parameters<BrowserContext["addCookies"]>[0];
    origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
  };
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as typeof state;
  } catch {
    fs.rmSync(file, { force: true });
    return;
  }
  if (state.cookies?.length) await context.addCookies(state.cookies);
  for (const origin of state.origins || []) {
    const page = await context.newPage();
    try {
      await page.goto(origin.origin, { waitUntil: "domcontentloaded", timeout: 10_000 });
      await page.evaluate((entries) => {
        for (const entry of entries) localStorage.setItem(entry.name, entry.value);
      }, origin.localStorage || []);
    } catch {
      process.stderr.write(`[stage] 跳过暂时无法恢复的 origin: ${new URL(origin.origin).origin}\n`);
    } finally {
      await withTimeout(page.close(), 2_000, "认证恢复临时页关闭超时").catch(() => undefined);
    }
  }
}

async function saveStorageState(context: BrowserContext, file: string): Promise<void> {
  await context.storageState({ path: file });
  fs.chmodSync(file, 0o600);
}

async function login(context: BrowserContext, keeper: Page): Promise<BrowserWorkerResult> {
  markStage("打开菜鸟登录验证页");
  await keeper.goto("about:blank");
  const loginPage = await context.newPage();
  await loginPage.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isLoginUrl(loginPage.url())) {
    process.stderr.write("请在打开的浏览器中完成菜鸟登录、验证码或短信验证。\n");
    await Promise.race([
      loginPage.waitForURL((url) => !isLoginUrl(url.href), { timeout: 10 * 60_000 }),
      loginPage.waitForEvent("close", { timeout: 10 * 60_000 })
    ]);
  }
  const verifyPage = loginPage.isClosed() ? keeper : loginPage;
  markStage("验证库存页登录状态");
  await verifyPage.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isLoginUrl(verifyPage.url())) throw new Error("菜鸟登录仍未完成。");
  await verifyPage.waitForTimeout(1500);
  return { ok: true, action: "login", loggedIn: true, pageUrl: verifyPage.url(), message: "菜鸟登录状态已验证。" };
}

async function exportInventory(context: BrowserContext, page: Page, request: BrowserWorkerRequest): Promise<BrowserWorkerResult> {
  if (!request.queryDate || !request.outputDir) throw new Error("导出请求缺少查询日期或下载目录。");
  markStage("打开库存多维查询页");
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isLoginUrl(page.url())) throw new Error("菜鸟登录态已失效，请重新执行登录。");
  await page.waitForTimeout(2500);

  markStage("使用菜鸟默认库存日期");
  await prepareDefaultInventoryView(page);
  await page.waitForTimeout(1500);
  markStage("等待导出明细按钮");
  const exportButton = await findInventoryExportButton(page);
  markStage("点击导出明细");
  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await exportButton.click({ force: true });
  markStage("等待库存文件下载");
  const download = await downloadPromise;
  const file = path.join(request.outputDir, `库存明细_${request.queryDate}_${Date.now()}.xlsx`);
  markStage("保存库存文件");
  await download.saveAs(file);
  if (!fs.existsSync(file) || fs.statSync(file).size < 100) throw new Error("下载文件为空或不完整。");
  fs.chmodSync(file, 0o600);
  return { ok: true, action: "export", loggedIn: true, file, pageUrl: page.url(), message: "库存文件已下载。" };
}

async function captureDiagnostic(page: Page | undefined, dir: string, action: string): Promise<void> {
  if (!page) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const screenshot = path.join(dir, `${stamp}-${action}.png`);
    await withTimeout(page.screenshot({ path: screenshot, fullPage: true }), 8_000, "诊断截图超时");
    fs.chmodSync(screenshot, 0o600);
  } catch {}
  try {
    const content = await withTimeout(page.content(), 5_000, "诊断页面保存超时");
    fs.writeFileSync(path.join(dir, `${stamp}-${action}.html`), content, { mode: 0o600 });
  } catch {}
}

function markStage(stage: string): void {
  currentStage = stage;
  process.stderr.write(`[stage] ${stage}\n`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isLoginUrl(url: string): boolean {
  return /login|passport|signin/i.test(url);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, action: "login", loggedIn: false, message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
