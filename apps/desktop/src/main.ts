import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { app, dialog, Menu, nativeImage, shell, Tray } from "electron";

/*
 * ── Resource layout (packaged app) ──────────────────────────────
 *   process.resourcesPath/server/nakama-server     Bun-compiled server binary
 *   process.resourcesPath/server/packages/core     packages/core checkout (NAKAMA_CORE_DIR)
 *   process.resourcesPath/bun/bin/bun              Bun runtime for spawned tool processes
 *
 * Dev mode: set NAKAMA_DESKTOP_RESOURCES to the dist-server/ directory,
 * e.g.  NAKAMA_DESKTOP_RESOURCES=$(pwd)/apps/desktop/dist-server  electron .
 */

function resourcesRoot(): string {
  const envRoot = process.env.NAKAMA_DESKTOP_RESOURCES;
  if (envRoot) {
    return resolve(envRoot);
  }
  return join(process.resourcesPath, "server");
}

function bunRuntimeRoot(): string {
  const envRoot = process.env.NAKAMA_DESKTOP_RESOURCES;
  if (envRoot) {
    return join(envRoot, "bun");
  }
  return join(process.resourcesPath, "bun");
}

function coreDir(): string {
  return join(resourcesRoot(), "packages", "core");
}

function serverBinary(): string {
  return join(resourcesRoot(), "nakama-server");
}

function bunBinPath(): string {
  const base = bunRuntimeRoot();
  const bunBinary = process.platform === "win32" ? "bun.exe" : "bun";
  return join(base, "bin", bunBinary);
}

/* ── Free-port pick ───────────────────────────────────────────── */
async function pickPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer({ allowHalfOpen: false });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine port")));
      }
    });
    srv.on("error", reject);
  });
}

/* ── Health polling ────────────────────────────────────────────── */
async function waitForHealthy(
  port: number,
  intervalMs = 500,
  timeoutMs = 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await sleep(intervalMs);
  }

  throw new Error(`Server did not become healthy within ${timeoutMs / 1000}s`);
}

/* ── Tray icon ─────────────────────────────────────────────────── */
function createTrayIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 8,
    cy = 8,
    r = 6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const idx = (y * size + x) * 4;
        buf[idx] = 0xff;
        buf[idx + 1] = 0xff;
        buf[idx + 2] = 0xff;
        buf[idx + 3] = 0xff;
      }
    }
  }

  const img = nativeImage.createFromBuffer(buf, {
    height: size,
    width: size,
  });
  img.setTemplateImage(true);
  return img;
}

/* ── Server lifecycle ──────────────────────────────────────────── */
let serverProcess: ChildProcess | null = null;
let runningPort: number | null = null;

function stopServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const proc = serverProcess;
    serverProcess = null;
    runningPort = null;

    proc.kill("SIGTERM");

    const killTimer = setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill("SIGKILL");
      }
      resolve();
    }, 3000);

    proc.on("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
  });
}

async function startServer(port: number): Promise<void> {
  const dataDir = join(app.getPath("userData"), "nakama");

  // Ensure the sqlite directory exists
  const sqliteDir = join(dataDir, "sqlite");
  if (!existsSync(sqliteDir)) {
    mkdirSync(sqliteDir, { recursive: true });
  }

  const serverBin = serverBinary();

  serverProcess = spawn(serverBin, [], {
    env: {
      BUN_INSTALL_BIN: bunBinPath(),
      BUN_INSTALL_GLOBAL_DIR: join(dataDir, ".bun"),
      DATABASE_URL: `file:${join(dataDir, "sqlite", "nakama.sqlite")}`,
      NAKAMA_CONFIG_DIR: dataDir,
      NAKAMA_CORE_DIR: coreDir(),
      NAKAMA_PORT: String(port),
      NAKAMA_SCHEMA_PATH: join(
        resourcesRoot(),
        "packages",
        "db",
        "sql",
        "schema.sql"
      ),
      NODE_ENV: "production",
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[server] ${chunk.toString().trimEnd()}`);
  });

  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[server:err] ${chunk.toString().trimEnd()}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[server] exited with code ${code}`);
    serverProcess = null;
  });

  runningPort = port;
}

async function bootServer(port: number): Promise<void> {
  console.log(`[desktop] starting server on port ${port}…`);
  await startServer(port);

  console.log("[desktop] waiting for server health…");
  try {
    await waitForHealthy(port);
  } catch (err) {
    dialog.showErrorBox(
      "Nakama Server Error",
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
    return;
  }

  const dashUrl = `http://127.0.0.1:${port}`;
  console.log(`[desktop] server healthy at ${dashUrl}`);
  await shell.openExternal(dashUrl);
}

/* ── Tray setup ────────────────────────────────────────────────── */
function setupTray(): void {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip("Nakama");

  const ctx = Menu.buildFromTemplate([
    {
      click: () => {
        const port = runningPort ?? 4310;
        shell.openExternal(`http://127.0.0.1:${port}`);
      },
      label: "Open Dashboard",
    },
    { type: "separator" },
    {
      click: async () => {
        await stopServer();
        const port = await pickPort();
        await bootServer(port);
      },
      label: "Restart Server",
    },
    { type: "separator" },
    {
      click: () => {
        app.quit();
      },
      label: "Quit",
    },
  ]);

  tray.setContextMenu(ctx);
}

/* ── App lifecycle ─────────────────────────────────────────────── */
const gotLock = app.requestSingleInstanceLock();

if (gotLock) {
  app.on("second-instance", () => {
    // Future: focus existing window
  });

  app.on("window-all-closed", () => {
    // Tray app — keep running
  });

  app.on("before-quit", async (event) => {
    event.preventDefault();
    await stopServer();
    app.exit(0);
  });

  app.whenReady().then(async () => {
    setupTray();

    const port = await pickPort();
    await bootServer(port);
  });
} else {
  app.quit();
}
