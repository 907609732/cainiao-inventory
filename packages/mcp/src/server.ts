import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCainiaoAutomation, startSetupServer, type SetupServerHandle } from "cainiao-inventory-automation-core";

const automation = createCainiaoAutomation();
const server = new McpServer({ name: "cainiaoInventory", version: "1.0.0" });
let setup: SetupServerHandle | null = null;

server.registerTool("cainiao_doctor", {
  description: "Check whether macOS, runtime, Cainiao login, report policy, DingTalk, and scheduling are ready. Always call this first.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, idempotentHint: true }
}, async () => result(await automation.doctor()));

server.registerTool("cainiao_open_setup", {
  description: "Open the secure localhost setup wizard. Secrets are entered there and stored in macOS Keychain, never in MCP arguments.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: false, idempotentHint: true }
}, async () => {
  if (!setup) setup = await startSetupServer(automation, { autoOpen: true, pluginRoot: process.env.CAINIAO_PLUGIN_ROOT });
  return result({ opened: true, url: setup.url });
});

server.registerTool("cainiao_login", {
  description: "Open the dedicated browser profile and wait for the user to complete Cainiao login or verification.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: false, idempotentHint: true }
}, async () => result(await automation.login()));

server.registerTool("cainiao_run_inventory", {
  description: "Export, validate, normalize, report, and optionally send Cainiao inventory. Validation failure always blocks delivery.",
  inputSchema: z.object({
    mode: z.enum(["validate_only", "send"]).default("send"),
    queryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    forceSend: z.boolean().default(false),
    acceptanceLabel: z.string().max(40).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
}, async (input) => {
  const value = await automation.runInventory(input);
  return result(value, value.status !== "succeeded");
});

server.registerTool("cainiao_get_status", {
  description: "Return redacted setup, last-run, active-run, and schedule status.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, idempotentHint: true }
}, async () => result(await automation.getStatus()));

server.registerTool("cainiao_get_run", {
  description: "Return one redacted run manifest by runId.",
  inputSchema: z.object({ runId: z.string().min(1).max(100) }),
  annotations: { readOnlyHint: true, idempotentHint: true }
}, async ({ runId }) => {
  const value = automation.getRun(runId);
  return value ? result(value) : result({ error: "run_not_found", runId }, true);
});

server.registerTool("cainiao_test_dingtalk", {
  description: "Send one clearly labeled DingTalk connection test containing no business data.",
  inputSchema: z.object({ label: z.string().max(40).default("【插件连接测试】") }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
}, async ({ label }) => result(await automation.testDingTalk(label)));

server.registerTool("cainiao_install_schedule", {
  description: "Install or update the macOS launchd schedule after setup and dry-run validation.",
  inputSchema: z.object({
    hour: z.number().int().min(0).max(23).default(22),
    minute: z.number().int().min(0).max(59).default(0),
    catchUpHours: z.number().int().min(0).max(168).default(24)
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
}, async (input) => result(automation.installSchedule(input)));

server.registerTool("cainiao_remove_schedule", {
  description: "Disable and remove the macOS launchd schedule without deleting inventory data or Keychain secrets.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
}, async () => {
  automation.removeSchedule();
  return result({ removed: true });
});

server.registerTool("cainiao_retry_delivery", {
  description: "Explicitly retry DingTalk delivery for an already validated run. Use only after the user requests a retry.",
  inputSchema: z.object({ runId: z.string().min(1).max(100), force: z.boolean().default(false) }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
}, async ({ runId, force }) => {
  const value = await automation.retryDelivery(runId, force);
  return result(value, value.status !== "succeeded");
});

server.registerResource("cainiao-status", "cainiao://status", {
  title: "Cainiao Inventory Status",
  description: "Redacted setup and automation status",
  mimeType: "application/json"
}, async (uri) => resource(uri.href, await automation.getStatus()));

server.registerResource("cainiao-config", "cainiao://config", {
  title: "Cainiao Inventory Config",
  description: "Non-secret local configuration",
  mimeType: "application/json"
}, async (uri) => resource(uri.href, automation.config()));

server.registerResource("cainiao-run", new ResourceTemplate("cainiao://runs/{runId}", { list: undefined }), {
  title: "Cainiao Inventory Run",
  description: "One redacted run manifest",
  mimeType: "application/json"
}, async (uri, variables) => resource(uri.href, automation.getRun(String(variables.runId)) || { error: "run_not_found" }));

function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === "object" ? value as Record<string, unknown> : { value },
    ...(isError ? { isError: true } : {})
  };
}

function resource(uri: string, value: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("cainiaoInventory MCP ready on stdio");
}

async function shutdown(): Promise<void> {
  if (setup) await setup.close().catch(() => undefined);
  await server.close();
}

process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
