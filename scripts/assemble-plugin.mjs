import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugins", "cainiao-inventory-codex");
const runtime = path.join(plugin, "runtime");
fs.mkdirSync(runtime, { recursive: true });
for (const stale of [
  "cli.js",
  "cli.js.map",
  "cli.cjs.map",
  "browser-worker.js.map",
  "mcp-server.js",
  "mcp-server.js.map",
  "mcp-server.cjs.map"
]) {
  fs.rmSync(path.join(runtime, stale), { force: true });
}

const copies = [
  ["packages/core/dist/cli.cjs", "runtime/cli.cjs"],
  ["packages/core/dist/browser-worker.js", "runtime/browser-worker.js"],
  ["packages/mcp/dist/mcp-server.cjs", "runtime/mcp-server.cjs"]
];
for (const [source, destination] of copies) {
  const from = path.join(root, source);
  if (!fs.existsSync(from)) throw new Error(`Missing build output: ${source}`);
  fs.copyFileSync(from, path.join(plugin, destination));
}
for (const name of fs.readdirSync(path.join(plugin, "scripts"))) {
  if (name.endsWith(".sh")) fs.chmodSync(path.join(plugin, "scripts", name), 0o755);
}
console.log(`Plugin runtime assembled at ${runtime}`);
