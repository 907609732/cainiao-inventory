import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import XLSX from "xlsx";
import { createDateExceptionService } from "../core/date-exception-send.mjs";
const hash = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function fixture(t, { sourceDate = "2026-10-31", errors, sendResult } = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cainiao-date-exception-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "downloads");
  fs.mkdirSync(dir);
  const file = path.join(dir, "demo.xlsx"),
    dbPath = path.join(root, "erp.sqlite");
  const rows = Array.from({ length: 10 }, (_, i) => ({
    日期: `${sourceDate}~${sourceDate}`,
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
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE inventory_data_validations(id INTEGER PRIMARY KEY,warehouse_id TEXT,source_file TEXT,source_date TEXT,expected_source_date TEXT,status TEXT,row_count INTEGER,total_quantity REAL,checks_json TEXT);CREATE TABLE inventory_snapshots(id INTEGER);",
  );
  const checks = {
    errors: errors || [`来源日期异常：期望 2026-11-01，实际 ${sourceDate}`],
    fileHash: hash(file),
    previousFile: "",
    minRows: 10,
  };
  db.prepare(
    "INSERT INTO inventory_data_validations VALUES(1,?,?,?,?,?,?,?,?)",
  ).run(
    "cainiao",
    "demo.xlsx",
    sourceDate,
    "2026-11-01",
    "invalid",
    10,
    170,
    JSON.stringify(checks),
  );
  db.close();
  let calls = 0,
    delivered,
    targets = {
      settings: { dingtalkEnabled: false, wecomEnabled: true },
      secrets: { wecomKey: "DEMO_ONLY" },
    };
  let targetHook = async () => {};
  let clock = Date.parse("2026-11-01T16:00:00Z");
  const service = createDateExceptionService({
    databasePath: dbPath,
    downloadDir: dir,
    auditPath: path.join(root, "audit.jsonl"),
    expectedDate: () => "2026-11-01",
    now: () => clock,
    getTargets: async () => {
      await targetHook();
      return targets;
    },
    send: async (payload) => {
      calls++;
      delivered = payload;
      return (
        sendResult || {
          accepted: true,
          channels: { wecom: { status: "accepted" } },
        }
      );
    },
  });
  return {
    root,
    file,
    dbPath,
    service,
    rows,
    get calls() {
      return calls;
    },
    get delivered() {
      return delivered;
    },
    setTargetHook(hook) {
      targetHook = hook;
    },
    changeTargets() {
      targets = {
        ...targets,
        settings: { ...targets.settings, emailTo: "changed@example.test" },
      };
    },
    expire() {
      clock += 180000;
    },
  };
}
test("date-only failure requires confirmation, sends exact stale data and preserves ledger", async (t) => {
  const f = fixture(t),
    before = hash(f.dbPath);
  assert.equal(f.service.available(), true);
  const p = await f.service.preview();
  assert.equal(p.sourceDate, "2026-10-31");
  assert.equal(p.expectedSourceDate, "2026-11-01");
  await assert.rejects(f.service.send({ token: p.token, confirmed: false }));
  assert.equal(f.calls, 0);
  const result = await f.service.send({ token: p.token, confirmed: true });
  assert.equal(result.accepted, true);
  assert.match(f.delivered.text, /日期异常/);
  assert.match(f.delivered.text, /2026-10-31/);
  assert.match(f.delivered.text, /2026-11-01/);
  assert.equal(hash(f.dbPath), before);
  await assert.rejects(f.service.send({ token: p.token, confirmed: true }));
  assert.equal(f.calls, 1);
  assert.equal(f.service.available(), false);
});
test("other validation failures and future source dates never offer special send", (t) => {
  assert.equal(
    fixture(t, { errors: ["缺少必需列：期末库存"] }).service.available(),
    false,
  );
  assert.equal(
    fixture(t, { sourceDate: "2026-11-02" }).service.available(),
    false,
  );
});
test("file replacement, superseded validation, target changes and expired preview invalidate confirmation", async (t) => {
  for (const change of ["file", "record", "targets", "expired"]) {
    const f = fixture(t),
      p = await f.service.preview();
    if (change === "file") fs.appendFileSync(f.file, "changed");
    if (change === "record") {
      const db = new DatabaseSync(f.dbPath);
      db.exec("UPDATE inventory_data_validations SET id=2");
      db.close();
    }
    if (change === "targets") f.changeTargets();
    if (change === "expired") f.expire();
    await assert.rejects(f.service.send({ token: p.token, confirmed: true }));
    assert.equal(f.calls, 0, change);
  }
});
test("partial or unknown result cannot be resent after service restart", async (t) => {
  const f = fixture(t, {
    sendResult: { accepted: false, channels: { wecom: { status: "unknown" } } },
  });
  const p = await f.service.preview();
  await f.service.send({ token: p.token, confirmed: true });
  await assert.rejects(f.service.preview());
  assert.equal(f.calls, 1);
});
test("changed arithmetic or cross-day baseline cannot bypass validation", async (t) => {
  const f = fixture(t);
  const prior = path.join(path.dirname(f.file), "prior.xlsx");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      f.rows.map((r) => ({
        ...r,
        日期: "2026-10-30~2026-10-30",
        期初库存: "1002",
        入库汇总: "2",
        出库汇总: "5",
        期末库存: "999",
      })),
    ),
    "库存",
  );
  XLSX.writeFile(book, prior);
  const db = new DatabaseSync(f.dbPath);
  const row = db
    .prepare("SELECT checks_json AS checks FROM inventory_data_validations")
    .get();
  const checks = JSON.parse(row.checks);
  checks.previousFile = "prior.xlsx";
  checks.previousFileHash = hash(prior);
  db.prepare("UPDATE inventory_data_validations SET checks_json=?").run(
    JSON.stringify(checks),
  );
  db.close();
  await assert.rejects(f.service.preview(), /日期以外/);
  assert.equal(f.calls, 0);
});
test("audit persists across service recreation without exposing secret values", async (t) => {
  const f = fixture(t),
    p = await f.service.preview();
  await f.service.send({ token: p.token, confirmed: true });
  assert.doesNotMatch(
    fs.readFileSync(path.join(f.root, "audit.jsonl"), "utf8"),
    /DEMO_ONLY/,
  );
  const restarted = createDateExceptionService({
    databasePath: f.dbPath,
    downloadDir: path.dirname(f.file),
    auditPath: path.join(f.root, "audit.jsonl"),
    expectedDate: () => "2026-11-01",
    getTargets: async () => ({}),
    send: async () => assert.fail("duplicate send"),
  });
  assert.equal(restarted.available(), false);
  await assert.rejects(restarted.preview());
});
test("concurrent confirmations cannot duplicate one file delivery", async (t) => {
  const f = fixture(t);
  const a = await f.service.preview(),
    b = await f.service.preview();
  const results = await Promise.allSettled([
    f.service.send({ token: a.token, confirmed: true }),
    f.service.send({ token: b.token, confirmed: true }),
  ]);
  assert.equal(f.calls, 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("file or validation changes during asynchronous secret reads are blocked at final dispatch", async (t) => {
  for (const kind of ["file", "validation", "expiry"]) {
    const f = fixture(t),
      p = await f.service.preview();
    f.setTargetHook(async () => {
      if (kind === "file") fs.appendFileSync(f.file, "changed");
      if (kind === "validation") {
        const db = new DatabaseSync(f.dbPath);
        db.exec("UPDATE inventory_data_validations SET id=2");
        db.close();
      }
      if (kind === "expiry") f.expire();
    });
    await assert.rejects(f.service.send({ token: p.token, confirmed: true }));
    assert.equal(f.calls, 0, kind);
  }
});
