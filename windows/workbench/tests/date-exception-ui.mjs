import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import XLSX from "../core/xlsx.js";
import { _electron } from "playwright";
process.chdir(path.resolve(import.meta.dirname, ".."));
const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cainiao-date-exception-ui-"),
  ),
  workspace = path.join(root, "workspace"),
  data = path.join(workspace, "data"),
  downloads = path.join(workspace, "downloads");
fs.mkdirSync(downloads, { recursive: true });
fs.mkdirSync(data, { recursive: true });
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    /^(LINGTU_|CAINIAO_|ERP_|DINGTALK_)|^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|SOCKS_PROXY)$/.test(
      k,
    )
  )
    delete env[k];
Object.assign(env, {
  CAINIAO_APP_DATA_DIR: workspace,
  ERP_DATA_DIR: data,
  CAINIAO_EXPECTED_SOURCE_DATE: "2026-11-01",
  LINGTU_ISOLATED_TEST: "1",
  LINGTU_TEST_LEDGER: "1",
  LINGTU_MANAGED_MODULE: "0",
  NO_PROXY: "127.0.0.1,localhost",
});
delete env.ELECTRON_RUN_AS_NODE;
const init = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "import {getDb,closeDb} from './core/erp/db.js';getDb();closeDb();",
  ],
  { env, encoding: "utf8", windowsHide: true },
);
assert.equal(init.status, 0, init.stderr);
fs.writeFileSync(
  path.join(root, "settings.json"),
  JSON.stringify({
    runtimeMode: "standalone",
    firstRunPending: false,
    scheduleEnabled: false,
    monthlySalesEnabled: false,
    startAtLogin: false,
  }),
);
const file = path.join(downloads, "DEMO-date-mismatch.xlsx");
const rows = Array.from({ length: 10 }, (_, i) => ({
  日期: "2026-10-31~2026-10-31",
  货品条码: "DEMO-" + i,
  货品名称: "演示商品 " + i,
  期初库存: "20",
  入库汇总: "2",
  出库汇总: "5",
  期末库存: "17",
  近30天销量: "30",
}));
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "库存");
XLSX.writeFile(book, file);
const hash = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const dbPath = path.join(data, "erp.sqlite");
let db = new DatabaseSync(dbPath);
db.prepare(
  "INSERT INTO inventory_data_validations(warehouse_id,source_file,source_date,expected_source_date,status,row_count,total_quantity,checks_json,error_text) VALUES(?,?,?,?,?,?,?,?,?)",
).run(
  "cainiao",
  path.basename(file),
  "2026-10-31",
  "2026-11-01",
  "invalid",
  10,
  170,
  JSON.stringify({
    errors: ["来源日期异常：期望 2026-11-01，实际 2026-10-31"],
    fileHash: hash(file),
    previousFile: "",
  }),
  "来源日期异常",
);
db.close();
const before = hash(dbPath),
  requests = [];
const server = http.createServer((req, res) => {
  let text = "";
  req.on("data", (b) => (text += b));
  req.on("end", () => {
    requests.push(JSON.parse(text));
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"errcode":0}');
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let app;
try {
  const exe = process.env.WAREHOUSE_TEST_EXE;
  app = await _electron.launch({
    executablePath: exe
      ? path.resolve(exe)
      : path.resolve("node_modules/electron/dist/electron.exe"),
    args: [...(exe ? [] : ["."]), "--user-data-dir=" + root],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.inventoryApp);
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), root);
  await page.evaluate(
    (url) =>
      window.inventoryApp.saveSettingsSection({
        section: "robot",
        settings: { dingtalkEnabled: true, deliveryMode: "webhook" },
        secrets: { dingtalkWebhook: url },
      }),
    "http://127.0.0.1:" + server.address().port + "/synthetic",
  );
  const access = await page.evaluate(() => window.inventoryApp.getLocalAccess());
  const ai = await page.evaluate(() => window.inventoryApp.createAiCredential({write:true,confirmed:true}));
  const aiPreviewResponse = await fetch(access.origin+'/api/v1/call/previewDateException', {
    method:'POST',headers:{authorization:'Bearer '+ai.token,'content-type':'application/json'},body:'{}',
  });
  assert.equal(aiPreviewResponse.status,200);
  const aiPreview = await aiPreviewResponse.json();
  assert.equal(typeof aiPreview.value.token,'string');
  assert.equal(requests.length,0,'AI preview cannot send a report');
  await page.locator("#dateExceptionSend").waitFor({ state: "visible" });
  await page.locator("#dateExceptionSend").click();
  await page.locator("#dateExceptionDialog").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#dateExceptionSummary").innerText(),
    /2026-11-01/,
  );
  assert.match(
    await page.locator("#dateExceptionSummary").innerText(),
    /2026-10-31/,
  );
  assert.equal(requests.length, 0);
  await page.locator("#dateExceptionCancel").click();
  assert.equal(requests.length, 0);
  assert.equal(await page.locator("#dateExceptionDialog").isVisible(), false);
  await assert.rejects(
    page.evaluate(() =>
      window.inventoryApp.sendDateException({ confirmed: true }),
    ),
  );
  assert.equal(requests.length, 0);
  await page.locator("#dateExceptionSend").click();
  await page.locator("#dateExceptionDialog").waitFor({ state: "visible" });
  await page.locator("#dateExceptionConfirm").click();
  await page.waitForFunction(() =>
    document
      .getElementById("logs")
      .textContent.includes("日期异常库存特殊发送完成"),
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].markdown.text, /日期异常/);
  assert.match(requests[0].markdown.text, /2026-10-31/);
  assert.equal(await page.locator("#dateExceptionSend").isVisible(), false);
  await app.close();
  app = null;
  db = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(
    db.prepare("SELECT status FROM inventory_data_validations").get().status,
    "invalid",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM inventory_snapshots").get().n,
    0,
  );
  db.close();
  assert.equal(hash(dbPath), before);
  console.log(
    JSON.stringify({
      ok: true,
      conditionalButton: true,
      cancelDoesNotSend: true,
      confirmedLocalMockMessages: 1,
      normalLedgerUnchanged: true,
      realProviderMessagesSent: false,
      packaged: Boolean(exe),
    }),
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
