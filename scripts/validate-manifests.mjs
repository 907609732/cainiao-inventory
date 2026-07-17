import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pluginRoot = path.join(root, "plugins", "cainiao-inventory-codex");
const plugin = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const marketplace = JSON.parse(fs.readFileSync(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
const mcp = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
const skill = fs.readFileSync(path.join(pluginRoot, "skills", "cainiao-inventory-automation", "SKILL.md"), "utf8");

const fail = (message) => { throw new Error(message); };
if (plugin.name !== "cainiao-inventory-codex" || plugin.version !== "1.0.0") fail("Plugin identity/version mismatch");
if (plugin.mcpServers !== "./.mcp.json" || !mcp.mcpServers?.cainiaoInventory) fail("MCP manifest missing");
if (marketplace.name !== "cainiao-tools") fail("Marketplace name mismatch");
if (!marketplace.plugins?.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/cainiao-inventory-codex")) fail("Marketplace entry missing");
if (!skill.startsWith("---\nname: cainiao-inventory-automation\ndescription:")) fail("Skill frontmatter invalid");
for (const file of [
  path.join(pluginRoot, "runtime", "mcp-server.cjs"),
  path.join(pluginRoot, "runtime", "cli.cjs"),
  path.join(pluginRoot, "runtime", "browser-worker.js"),
  path.join(pluginRoot, "runtime", "browser-package-lock.json")
]) if (!fs.existsSync(file)) fail(`Missing runtime artifact: ${path.relative(root, file)}`);
if (JSON.stringify(plugin).includes("TODO") || skill.includes("[TODO:")) fail("TODO placeholder remains");
console.log("Manifest and artifact validation passed.");
