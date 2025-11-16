/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "ai.nof1.desktop",
  productName: "nof1.ai",
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: [
    "dist/**/*",
    "public/**/*",
    "electron/**/*",
    "package.json",
    "node_modules/**/*",
    "!release/**/*",
    "!**/*.log",
  ],
  asar: true,
  extraMetadata: {
    main: "electron/main.cjs",
  },
  mac: {
    category: "public.app-category.finance",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
    ],
    artifactName: "nof1-ai-${version}-${arch}.${ext}",
  },
  dmg: {
    sign: false,
  },
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    artifactName: "nof1-ai-${version}-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  publish: null,
};
