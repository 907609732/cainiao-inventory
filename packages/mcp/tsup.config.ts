import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "mcp-server": "src/server.ts" },
  format: ["cjs"],
  bundle: true,
  noExternal: [/.*/],
  sourcemap: false,
  clean: true,
  target: "node22",
  outExtension: () => ({ js: ".cjs" })
});
