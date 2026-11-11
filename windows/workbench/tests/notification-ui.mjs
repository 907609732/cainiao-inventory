import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron } from "playwright";
process.chdir(path.resolve(import.meta.dirname, ".."));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cainiao-notification-ui-")),
  settingsFile = path.join(root, "settings.json");
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    runtimeMode: "standalone",
    firstRunPending: false,
    dingtalkEnabled: false,
    scheduleEnabled: false,
    monthlySalesEnabled: false,
    startAtLogin: false,
  }),
);
const env = {...process.env};
for (const key of Object.keys(env)) if (/^(LINGTU_|ERP_|CAINIAO_|DINGTALK_)/.test(key)) delete env[key];
Object.assign(env, {
  LINGTU_ISOLATED_TEST: "1",
  LINGTU_TEST_LEDGER: "1",
  LINGTU_MANAGED_MODULE: "0",
  CAINIAO_APP_DATA_DIR: path.join(root, "workspace"),
  ERP_DATA_DIR: path.join(root, "workspace", "data"),
});
delete env.ELECTRON_RUN_AS_NODE;
let app;
const packaged = process.env.WAREHOUSE_TEST_EXE
  ? path.resolve(process.env.WAREHOUSE_TEST_EXE)
  : null;
const values = {
  feishuAppId: "demo-app",
  feishuAppSecret: "DEMO_FEISHU_SECRET",
  feishuReceiveId: "demo-chat",
  wecomKey: "DEMO_WECOM_SECRET",
  emailHost: "smtp.example.test",
  emailPort: "587",
  emailUser: "sender@example.test",
  emailPassword: "DEMO_SMTP_SECRET",
  emailTo: "recipient@example.test",
  telegramBotToken: "123:DEMO_TOKEN",
  telegramChatId: "-1001234567890",
  telegramProxyUrl: "http://127.0.0.1:8888",
};
try {
  app = await _electron.launch({
    executablePath:
      packaged || path.resolve("node_modules/electron/dist/electron.exe"),
    args: [...(packaged ? [] : ["."]), "--user-data-dir=" + root],
    env,
  });
  let page = await app.firstWindow();
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),root);
  await page.waitForFunction(() => !!window.inventoryApp);
  await page.locator('[data-view="settings"]').click();
  for (const id of ["feishu", "wecom", "email", "telegram"]) {
    await page.locator(`[data-notification-channel="${id}"] summary`).click();
    await page.locator("#" + id + "Enabled").check();
  }
  for (const [id, value] of Object.entries(values))
    await page.locator("#" + id).fill(value);
  await page.locator('#robotSettingsForm button[type="submit"]').click();
  await page.waitForFunction(
    () =>
      document.getElementById("robotSaveMessage").textContent === "保存成功",
  );
  const plain = fs.readFileSync(settingsFile, "utf8");
  for (const id of [
    "feishuAppSecret",
    "wecomKey",
    "emailPassword",
    "telegramBotToken",
    "telegramProxyUrl",
  ]) {
    assert.ok(!plain.includes(values[id]), id);
    assert.ok(
      !fs
        .readFileSync(path.join(root, "secrets.bin"))
        .includes(Buffer.from(values[id])),
      id,
    );
  }
  const sdkReady = await app.evaluate(({ app }) => {
    const m = process.getBuiltinModule("module"),
      path = process.getBuiltinModule("path");
    const sdk = m.createRequire(path.join(app.getAppPath(), "package.json"))(
      "push-all-in-one",
    );
    return ["Feishu", "WechatRobot", "CustomEmail", "Telegram"].every(
      (name) => typeof sdk[name] === "function",
    );
  });
  assert.equal(sdkReady, true);
  const saved = await page.evaluate(() => window.inventoryApp.getSettings());
  assert.equal(saved.dingtalkEnabled, false);
  assert.equal(saved.feishuEnabled, true);
  assert.equal(saved.emailEnabled, true);
  assert.equal(saved.emailPort, 587);
  assert.equal(saved.secretFlags.telegramBotToken, true);
  await page.locator("#telegramProxyUrl").fill("");
  await page.locator('[data-clear-secret="telegramProxyUrl"]').check();
  await page.locator('#robotSettingsForm button[type="submit"]').click();
  await page.waitForFunction(
    () =>
      document.getElementById("robotSaveMessage").textContent === "保存成功",
  );
  assert.equal(
    (await page.evaluate(() => window.inventoryApp.getSettings())).secretFlags
      .telegramProxyUrl,
    false,
    "clearing proxy restores direct connection",
  );
  await app.close();
  app = null;
  app = await _electron.launch({
    executablePath:
      packaged || path.resolve("node_modules/electron/dist/electron.exe"),
    args: [...(packaged ? [] : ["."]), "--user-data-dir=" + root],
    env,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.inventoryApp);
  const reloaded = await page.evaluate(() => window.inventoryApp.getSettings());
  assert.equal(reloaded.telegramChatId, values.telegramChatId);
  assert.equal(reloaded.secretFlags.feishuAppSecret, true);
  assert.equal(reloaded.secretFlags.emailPassword, true);
  const state = await page.evaluate(() => window.inventoryApp.getState());
  assert.equal(state.running, false);
  assert.equal(Boolean(state.nextScheduledRun), false);
  console.log(
    JSON.stringify({
      ok: true,
      channels: ["feishu", "wecom", "email", "telegram"],
      encrypted: true,
      reloaded: true,
      realMessagesSent: false,
      isolated: true,
    }),
  );
} finally {
  await app?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
