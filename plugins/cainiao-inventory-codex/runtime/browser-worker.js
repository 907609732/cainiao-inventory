// src/browser-worker.ts
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

// src/browser-page.ts
async function prepareDefaultInventoryView(page) {
  const detailTab = await waitForFirstVisible(page, [
    page.getByRole("tab", { name: "\u5E93\u5B58\u660E\u7EC6", exact: true }).first(),
    page.locator('.cn-next-tabs-tab-inner:has-text("\u5E93\u5B58\u660E\u7EC6"), .cn-ui-tab-item:has-text("\u5E93\u5B58\u660E\u7EC6")').first(),
    page.getByText("\u5E93\u5B58\u660E\u7EC6", { exact: true }).first()
  ], 3e4);
  if (!detailTab) throw new Error("\u672A\u627E\u5230\u5E93\u5B58\u660E\u7EC6\u6807\u7B7E\uFF0C\u83DC\u9E1F\u9875\u9762\u53EF\u80FD\u5DF2\u7ECF\u6539\u7248\u3002");
  if (await detailTab.getAttribute("aria-selected") !== "true") {
    await detailTab.click({ force: true });
    await page.waitForTimeout(500);
  }
}
async function findInventoryExportButton(page, timeoutMs = 3e4) {
  const button = await waitForFirstVisible(page, [
    page.getByRole("button", { name: /导出明细/ }).first(),
    page.locator('button:has-text("\u5BFC\u51FA\u660E\u7EC6"), .ant-btn:has-text("\u5BFC\u51FA\u660E\u7EC6"), .cn-next-btn:has-text("\u5BFC\u51FA\u660E\u7EC6")').first(),
    page.getByText("\u5BFC\u51FA\u660E\u7EC6", { exact: true }).first()
  ], timeoutMs);
  if (!button) throw new Error("\u672A\u627E\u5230\u5BFC\u51FA\u660E\u7EC6\u6309\u94AE\uFF0C\u5DF2\u505C\u6B62\u4E14\u4E0D\u4F1A\u53D1\u9001\u9489\u9489\u3002");
  return button;
}
async function firstVisible(candidates) {
  for (const candidate of candidates) {
    if (await candidate.count() && await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}
async function waitForFirstVisible(page, candidates, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const match = await firstVisible(candidates);
    if (match) return match;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return null;
}

// src/browser-worker.ts
var TARGET_URL = "https://b.cainiao.com/business/dsc/oms/inventory/inventoryreport";
var currentStage = "\u542F\u52A8\u6D4F\u89C8\u5668";
async function main() {
  const request = JSON.parse(process.env.CAINIAO_BROWSER_REQUEST || "{}");
  if (!request.action || !request.profileDir || !request.storageStateFile || !request.diagnosticsDir) throw new Error("\u6D4F\u89C8\u5668\u8BF7\u6C42\u53C2\u6570\u4E0D\u5B8C\u6574\u3002");
  fs.mkdirSync(request.profileDir, { recursive: true, mode: 448 });
  fs.mkdirSync(request.diagnosticsDir, { recursive: true, mode: 448 });
  if (request.outputDir) fs.mkdirSync(request.outputDir, { recursive: true, mode: 448 });
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
    markStage("\u6062\u590D\u8BA4\u8BC1\u72B6\u6001");
    await restoreStorageState(context, request.storageStateFile);
    const page = context.pages()[0] || await context.newPage();
    const action = request.action === "login" ? login(context, page) : exportInventory(context, page, request);
    const result = request.action === "export" ? await withTimeout(action, 18e4, "\u6D4F\u89C8\u5668\u4EFB\u52A1\u8D85\u8FC7 180 \u79D2\u603B\u4E0A\u9650") : await action;
    markStage("\u5237\u65B0\u8BA4\u8BC1\u72B6\u6001");
    if (result.ok && result.loggedIn) await saveStorageState(context, request.storageStateFile);
    process.stdout.write(`${JSON.stringify(result)}
`);
  } catch (error) {
    await captureDiagnostic(context.pages()[0], request.diagnosticsDir, request.action);
    const result = {
      ok: false,
      action: request.action,
      loggedIn: false,
      stage: currentStage,
      message: `${currentStage}\uFF1A${error instanceof Error ? error.message : String(error)}`
    };
    process.stdout.write(`${JSON.stringify(result)}
`);
    process.exitCode = 1;
  } finally {
    await Promise.race([context.close(), new Promise((resolve) => setTimeout(resolve, 1e4))]);
  }
}
async function restoreStorageState(context, file) {
  if (!fs.existsSync(file)) return;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fs.rmSync(file, { force: true });
    return;
  }
  if (state.cookies?.length) await context.addCookies(state.cookies);
  for (const origin of state.origins || []) {
    const page = await context.newPage();
    try {
      await page.goto(origin.origin, { waitUntil: "domcontentloaded", timeout: 1e4 });
      await page.evaluate((entries) => {
        for (const entry of entries) localStorage.setItem(entry.name, entry.value);
      }, origin.localStorage || []);
    } catch {
      process.stderr.write(`[stage] \u8DF3\u8FC7\u6682\u65F6\u65E0\u6CD5\u6062\u590D\u7684 origin: ${new URL(origin.origin).origin}
`);
    } finally {
      await withTimeout(page.close(), 2e3, "\u8BA4\u8BC1\u6062\u590D\u4E34\u65F6\u9875\u5173\u95ED\u8D85\u65F6").catch(() => void 0);
    }
  }
}
async function saveStorageState(context, file) {
  await context.storageState({ path: file });
  fs.chmodSync(file, 384);
}
async function login(context, keeper) {
  markStage("\u6253\u5F00\u83DC\u9E1F\u767B\u5F55\u9A8C\u8BC1\u9875");
  await keeper.goto("about:blank");
  const loginPage = await context.newPage();
  await loginPage.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
  if (isLoginUrl(loginPage.url())) {
    process.stderr.write("\u8BF7\u5728\u6253\u5F00\u7684\u6D4F\u89C8\u5668\u4E2D\u5B8C\u6210\u83DC\u9E1F\u767B\u5F55\u3001\u9A8C\u8BC1\u7801\u6216\u77ED\u4FE1\u9A8C\u8BC1\u3002\n");
    await Promise.race([
      loginPage.waitForURL((url) => !isLoginUrl(url.href), { timeout: 10 * 6e4 }),
      loginPage.waitForEvent("close", { timeout: 10 * 6e4 })
    ]);
  }
  const verifyPage = loginPage.isClosed() ? keeper : loginPage;
  markStage("\u9A8C\u8BC1\u5E93\u5B58\u9875\u767B\u5F55\u72B6\u6001");
  await verifyPage.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
  if (isLoginUrl(verifyPage.url())) throw new Error("\u83DC\u9E1F\u767B\u5F55\u4ECD\u672A\u5B8C\u6210\u3002");
  await verifyPage.waitForTimeout(1500);
  return { ok: true, action: "login", loggedIn: true, pageUrl: verifyPage.url(), message: "\u83DC\u9E1F\u767B\u5F55\u72B6\u6001\u5DF2\u9A8C\u8BC1\u3002" };
}
async function exportInventory(context, page, request) {
  if (!request.queryDate || !request.outputDir) throw new Error("\u5BFC\u51FA\u8BF7\u6C42\u7F3A\u5C11\u67E5\u8BE2\u65E5\u671F\u6216\u4E0B\u8F7D\u76EE\u5F55\u3002");
  markStage("\u6253\u5F00\u5E93\u5B58\u591A\u7EF4\u67E5\u8BE2\u9875");
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
  if (isLoginUrl(page.url())) throw new Error("\u83DC\u9E1F\u767B\u5F55\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C\u767B\u5F55\u3002");
  await page.waitForTimeout(2500);
  markStage("\u4F7F\u7528\u83DC\u9E1F\u9ED8\u8BA4\u5E93\u5B58\u65E5\u671F");
  await prepareDefaultInventoryView(page);
  await page.waitForTimeout(1500);
  markStage("\u7B49\u5F85\u5BFC\u51FA\u660E\u7EC6\u6309\u94AE");
  const exportButton = await findInventoryExportButton(page);
  markStage("\u70B9\u51FB\u5BFC\u51FA\u660E\u7EC6");
  const downloadPromise = page.waitForEvent("download", { timeout: 45e3 });
  await exportButton.click({ force: true });
  markStage("\u7B49\u5F85\u5E93\u5B58\u6587\u4EF6\u4E0B\u8F7D");
  const download = await downloadPromise;
  const file = path.join(request.outputDir, `\u5E93\u5B58\u660E\u7EC6_${request.queryDate}_${Date.now()}.xlsx`);
  markStage("\u4FDD\u5B58\u5E93\u5B58\u6587\u4EF6");
  await download.saveAs(file);
  if (!fs.existsSync(file) || fs.statSync(file).size < 100) throw new Error("\u4E0B\u8F7D\u6587\u4EF6\u4E3A\u7A7A\u6216\u4E0D\u5B8C\u6574\u3002");
  fs.chmodSync(file, 384);
  return { ok: true, action: "export", loggedIn: true, file, pageUrl: page.url(), message: "\u5E93\u5B58\u6587\u4EF6\u5DF2\u4E0B\u8F7D\u3002" };
}
async function captureDiagnostic(page, dir, action) {
  if (!page) return;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  try {
    const screenshot = path.join(dir, `${stamp}-${action}.png`);
    await withTimeout(page.screenshot({ path: screenshot, fullPage: true }), 8e3, "\u8BCA\u65AD\u622A\u56FE\u8D85\u65F6");
    fs.chmodSync(screenshot, 384);
  } catch {
  }
  try {
    const content = await withTimeout(page.content(), 5e3, "\u8BCA\u65AD\u9875\u9762\u4FDD\u5B58\u8D85\u65F6");
    fs.writeFileSync(path.join(dir, `${stamp}-${action}.html`), content, { mode: 384 });
  } catch {
  }
}
function markStage(stage) {
  currentStage = stage;
  process.stderr.write(`[stage] ${stage}
`);
}
async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function isLoginUrl(url) {
  return /login|passport|signin/i.test(url);
}
main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, action: "login", loggedIn: false, message: error instanceof Error ? error.message : String(error) })}
`);
  process.exitCode = 1;
});
