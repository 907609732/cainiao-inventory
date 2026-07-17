import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    bundle: true,
    noExternal: [/.*/],
    dts: true,
    sourcemap: false,
    clean: true,
    target: "node22",
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' }
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["cjs"],
    bundle: true,
    noExternal: [/.*/],
    sourcemap: false,
    clean: false,
    target: "node22",
    outExtension: () => ({ js: ".cjs" }),
    banner: { js: "#!/usr/bin/env node" }
  },
  {
    entry: { "browser-worker": "src/browser-worker.ts" },
    format: ["esm"],
    bundle: true,
    external: ["playwright"],
    sourcemap: false,
    clean: false,
    target: "node22"
  }
]);
