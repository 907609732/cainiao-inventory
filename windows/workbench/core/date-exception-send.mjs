import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { toNumber, toText } from "./erp/sheets.js";
import XLSX from "./xlsx.js";
function readVerifiedRows(file, expectedHash) {
  const buffer = fs.readFileSync(file);
  if (digest(buffer) !== expectedHash) throw Error("文件已改变，请重新核对");
  const book = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
    defval: "",
    raw: false,
  });
}
import { calculateInventoryAvailability } from "./erp/inventory-alert.js";
import {
  enabledNotificationChannels,
  validateNotifications,
} from "../desktop/shared/notification-settings.mjs";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (file) => digest(fs.readFileSync(file));
const iso = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export function createDateExceptionService({
  databasePath,
  downloadDir,
  auditPath,
  expectedDate,
  now = () => Date.now(),
  getTargets,
  getTargetRevision = () => "",
  send,
}) {
  const tokens = new Map();
  function current() {
    if (!fs.existsSync(databasePath)) return null;
    let db;
    try {
      db = new DatabaseSync(databasePath, { readOnly: true });
      if (
        !db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='inventory_data_validations'",
          )
          .get()
      )
        return null;
      const row = db
        .prepare(
          "SELECT id,source_file AS file,source_date AS sourceDate,expected_source_date AS expectedSourceDate,status,row_count AS rowCount,total_quantity AS totalQuantity,checks_json AS checksJson FROM inventory_data_validations WHERE warehouse_id='cainiao' ORDER BY id DESC LIMIT 1",
        )
        .get();
      if (
        !row ||
        row.status !== "invalid" ||
        !iso(row.sourceDate) ||
        !iso(row.expectedSourceDate) ||
        row.sourceDate >= row.expectedSourceDate ||
        row.expectedSourceDate !== expectedDate() ||
        row.rowCount < 10
      )
        return null;
      const checks = JSON.parse(row.checksJson);
      if (
        !Array.isArray(checks.errors) ||
        checks.errors.length !== 1 ||
        checks.errors[0] !==
          `来源日期异常：期望 ${row.expectedSourceDate}，实际 ${row.sourceDate}`
      )
        return null;
      let hash = checks.fileHash;
      if (
        !hash &&
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='warehouse_sync_runs'",
          )
          .get()
      ) {
        for (const r of db
          .prepare(
            "SELECT payload FROM warehouse_sync_runs ORDER BY started_at DESC",
          )
          .all()) {
          const p = JSON.parse(r.payload);
          if (p.validationId === row.id) {
            hash = p.fileHash;
            break;
          }
        }
      }
      if (!/^[a-f0-9]{64}$/.test(hash || "")) return null;
      const resolve = (name) => {
        if (!name || path.basename(name) !== name) throw Error("文件路径无效");
        const file = path.join(downloadDir, name);
        if (fs.lstatSync(file).isSymbolicLink()) throw Error("不允许链接文件");
        return file;
      };
      const file = resolve(row.file);
      if (fileHash(file) !== hash) return null;
      const previous = checks.previousFile ? resolve(checks.previousFile) : "";
      const baselineHash = previous ? fileHash(previous) : "";
      if (checks.previousFileHash && checks.previousFileHash !== baselineHash)
        return null;
      return {
        ...row,
        file,
        previous,
        baselineHash,
        fileHash: hash,
        key: digest(hash + "|" + row.expectedSourceDate),
      };
    } catch {
      return null;
    } finally {
      db?.close();
    }
  }
  function auditRows() {
    if (!fs.existsSync(auditPath)) return [];
    return fs
      .readFileSync(auditPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const blocked = (row) => {
    const last = auditRows()
      .filter((r) => r.key === row.key)
      .at(-1);
    return Boolean(last && last.status !== "failed");
  };
  function available() {
    try {
      const row = current();
      return Boolean(row && !blocked(row));
    } catch {
      return false;
    }
  }
  async function prepare() {
    const row = current();
    if (!row || blocked(row))
      throw Error("当前没有可特殊发送的日期异常文件，或该文件已有发送记录");
    const { validateCainiaoInventoryRows } =
      await import("./erp/inventory-validation.js");
    const rows = readVerifiedRows(row.file, row.fileHash);
    const previousRows = row.previous
      ? readVerifiedRows(row.previous, row.baselineHash)
      : [];
    const validation = validateCainiaoInventoryRows(rows, {
      file: row.file,
      expectedSourceDate: row.expectedSourceDate,
      previousRows,
      previousFile: row.previous,
      minRows: 10,
    });
    if (
      validation.errors.length !== 1 ||
      validation.errors[0] !==
        `来源日期异常：期望 ${row.expectedSourceDate}，实际 ${row.sourceDate}` ||
      validation.sourceDate !== row.sourceDate ||
      validation.rowCount !== row.rowCount ||
      Math.abs(validation.totalQuantity - row.totalQuantity) > 0.001
    )
      throw Error("文件存在日期以外的校验问题，禁止特殊发送");
    // Read once more for the report, then verify all evidence again before dispatch.
    if (fileHash(row.file) !== row.fileHash)
      throw Error("文件已改变，请重新核对");
    const revision = getTargetRevision();
    const targets = await getTargets();
    if (getTargetRevision() !== revision)
      throw Error("接收配置已改变，请重新确认");
    const checked = validateNotifications(
      targets.settings,
      Object.fromEntries(
        Object.entries(targets.secrets).map(([k, v]) => [k, Boolean(v)]),
      ),
      { requireEnabled: true },
    );
    if (!checked.ok) throw Error(checked.errors.join("；"));
    const channels = enabledNotificationChannels(targets.settings),
      proof = digest(
        JSON.stringify([
          row.id,
          row.sourceDate,
          row.expectedSourceDate,
          row.fileHash,
          row.baselineHash,
          row.checksJson,
          targets.settings,
          targets.secrets,
          revision,
        ]),
      );
    const items = rows.map((r) => {
      const quantity = toNumber(r["期末库存"]),
        sales = toNumber(r["近30天销量"]),
        outbound = toNumber(r["出库汇总"]);
      return {
        sku: toText(r["货品条码"]),
        name: toText(r["货品名称"] || r["货品名"] || r["名称"]),
        totalQuantity: quantity,
        near30DaysSales: sales,
        monthlyOutbound: outbound,
        ...calculateInventoryAvailability({
          totalQuantity: quantity,
          near30DaysSales: sales,
          monthlyOutbound: outbound,
        }),
      };
    });
    const report = {
      snapshotDate: row.sourceDate,
      skuCount: items.length,
      totalQuantity: items.reduce((n, r) => n + r.totalQuantity, 0),
      items,
      lowStockItems: items
        .filter((r) => r.stockAlert.level !== "ok")
        .sort((a, b) => a.sellableDays - b.sellableDays),
    };
    const { buildInventoryMarkdown } = await import("./erp/reports.js");
    const markdown = buildInventoryMarkdown("table", report);
    const text = `## ⚠ 日期异常 · 人工确认发送\n\n期望来源日期：**${row.expectedSourceDate}**\n\n实际来源日期：**${row.sourceDate}**\n\n此文件日期偏旧，仅作参考；本次特殊发送不代表正常同步成功，不会导入正常库存。\n\n${markdown.text}`;
    return {
      row,
      proof,
      revision,
      targets,
      channels,
      title: `【日期异常】菜鸟云仓库存 ${row.sourceDate}`,
      text,
    };
  }
  async function preview() {
    const p = await prepare();
    const token = randomUUID(),
      expiresAt = now() + 120000;
    for (const [id, t] of tokens) if (t.expiresAt < now()) tokens.delete(id);
    tokens.set(token, { proof: p.proof, expiresAt });
    return {
      token,
      expiresAt,
      validationId: p.row.id,
      expectedSourceDate: p.row.expectedSourceDate,
      sourceDate: p.row.sourceDate,
      rowCount: p.row.rowCount,
      totalQuantity: p.row.totalQuantity,
      channels: p.channels,
    };
  }
  async function sendConfirmed({ token, confirmed } = {}) {
    if (confirmed !== true)
      throw Error("必须阅读日期异常提示并二次确认后才能发送");
    const saved = tokens.get(token);
    if (!saved || saved.expiresAt < now())
      throw Error("确认已过期，请重新查看数据");
    tokens.delete(token);
    const p = await prepare();
    if (saved.proof !== p.proof)
      throw Error("文件、校验记录或接收配置已改变，请重新确认");
    const append = (status, delivery) => {
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.appendFileSync(
        auditPath,
        JSON.stringify({
          key: p.row.key,
          at: new Date(now()).toISOString(),
          validationId: p.row.id,
          expectedSourceDate: p.row.expectedSourceDate,
          sourceDate: p.row.sourceDate,
          fileHash: p.row.fileHash,
          channels: p.channels,
          status,
          ...(delivery ? { delivery } : {}),
        }) + "\n",
      );
    };
    const latest = current();
    if (
      !latest ||
      JSON.stringify(latest) !== JSON.stringify(p.row) ||
      getTargetRevision() !== p.revision ||
      saved.expiresAt < now()
    )
      throw Error("文件、记录或配置已改变，或确认已过期，请重新确认");
    if (blocked(p.row)) throw Error("该文件已有发送记录，请勿重复发送");
    append("unknown");
    const result = await send({ title: p.title, text: p.text, ...p.targets });
    const states = Object.values(result.channels || {}).map((r) => r.status);
    const status = result.accepted
      ? "accepted"
      : states.length && states.every((s) => s === "failed")
        ? "failed"
        : "unknown";
    append(status, result);
    return result;
  }
  return { available, preview, send: sendConfirmed };
}
