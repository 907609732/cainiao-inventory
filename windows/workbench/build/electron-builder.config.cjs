const fs = require("node:fs");
const path = require("node:path");
const { buildBranding } = require("../desktop/shared/branding.cjs");

function preparedChannel() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve("build", "private", "build-info.json"), "utf8")).channel;
  } catch {
    return process.env.CAINIAO_INTERNAL_UPDATE_TOKEN ? "release" : "development";
  }
}

const branding = buildBranding(preparedChannel());

module.exports = {
  appId: "com.wucheng.cainiao.warehouse",
  executableName: "CainiaoWarehouse",
  productName: branding.productName,
  publish: [{
    provider: "github",
    owner: "907609732",
    repo: "cainiao-inventory",
    private: false,
    releaseType: "release"
  }],
  artifactName: `CainiaoWarehouse${branding.artifactMarker}-Setup-\${version}-\${arch}.\${ext}`,
  directories: {
    output: "dist",
    buildResources: "build"
  },
  files: [
    "desktop/**/*",
    "!desktop/launcher/**/*",
    "!desktop/workbench-client/**/*",
    "!desktop/workbench-migration/**/*",
    "!desktop/workbench/{gateway,server,store,manifest,policy}.mjs",
    "!desktop/modules/{module-manager,package-format,service-lifecycle,electron-lifecycle}.mjs",
    "!desktop/invoice-module/**/*",
    "core/**/*",
    "config.json",
    "package.json"
  ],
  extraResources: [
    { from: "build/private/update-token.txt", to: "update-token.txt" },
    { from: "build/private/build-info.json", to: "build-info.json" }
  ],
  asar: true,
  npmRebuild: false,
  win: {
    icon: "desktop/assets/lingtu-icon.png",
    target: [
      { target: "nsis", arch: ["x64"] }
    ]
  },
  nsis: {
    include: "build/local-web.nsh",
    oneClick: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: branding.productName,
    deleteAppDataOnUninstall: false
  }
};
