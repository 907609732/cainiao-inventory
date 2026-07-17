import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP exposes the expected tools and redacted resources over stdio", async () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cainiao-mcp-app-"));
  const serverFile = path.resolve("packages/mcp/dist/mcp-server.cjs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    env: { ...process.env, CAINIAO_APP_ROOT: appRoot }
  });
  const client = new Client({ name: "cainiao-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const name of [
      "cainiao_doctor",
      "cainiao_open_setup",
      "cainiao_login",
      "cainiao_run_inventory",
      "cainiao_get_status",
      "cainiao_get_run",
      "cainiao_test_dingtalk",
      "cainiao_install_schedule",
      "cainiao_remove_schedule",
      "cainiao_retry_delivery"
    ]) assert.ok(names.includes(name), `${name} missing`);
    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "cainiao://status"));
    const doctor = await client.callTool({ name: "cainiao_doctor", arguments: {} });
    assert.equal(doctor.isError, undefined);
    assert.ok(doctor.structuredContent);
  } finally {
    await client.close();
  }
});
