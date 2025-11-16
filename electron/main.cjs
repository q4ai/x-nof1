const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog } = require("electron");

const DEFAULT_PORT = process.env.PORT || "3141";
const isDev = process.env.NOF1_DESKTOP_DEV === "1";
const startUrl = process.env.ELECTRON_START_URL || `http://127.0.0.1:${DEFAULT_PORT}/`;

let backendProcess = null;
let isQuitting = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackend() {
  const timeoutMs = 60_000;
  const pollMs = 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(startUrl, { method: "HEAD" });
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return;
      }
    } catch (error) {
      if (error && error.code !== "ECONNREFUSED") {
        console.debug("等待后端启动失败", error);
      }
    }
    await delay(pollMs);
  }

  dialog.showErrorBox("后端未就绪", `等待 ${startUrl} 超时，请检查日志。`);
  throw new Error("backend start timeout");
}

function startBundledBackend() {
  if (isDev || backendProcess) {
    return;
  }

  const entryPoint = path.join(__dirname, "..", "dist", "index.js");
  backendProcess = spawn(process.execPath, [entryPoint], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: DEFAULT_PORT,
    },
    stdio: "inherit",
  });

  backendProcess.on("exit", (code, signal) => {
    backendProcess = null;
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox(
        "nof1.ai 后端已退出",
        `Node 进程异常退出 (code=${code}, signal=${signal ?? ""}). 请查看 release/logs。`
      );
      app.quit();
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#050505",
    webPreferences: {
      devTools: isDev,
    },
  });

  await waitForBackend();
  await win.loadURL(startUrl);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(async () => {
  try {
    startBundledBackend();
    await createWindow();
  } catch (error) {
    console.error("启动桌面应用失败", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (backendProcess) {
    backendProcess.kill();
  }
});
