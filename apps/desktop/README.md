# Nakama Desktop (Electron)

A macOS desktop shell that embeds the Nakama server as a standalone Bun-compiled
binary and wraps the dashboard in a system-tray application. Designed for local
first-party use and future distribution via DMG/NSIS installers.

## Architecture

```
apps/desktop/
├── src/main.ts              # Electron main process
├── scripts/
│   ├── compile-server.ts    # Bun --compile server + copy packages/core
│   └── fetch-runtime.ts     # Download Bun runtime for spawned tool processes
├── electron-builder.yml     # Packaging config (macOS + Windows)
├── tsconfig.json
└── package.json
```

### Resource layout (packaged app)

| Runtime path | Origin |
|---|---|
| `process.resourcesPath/server/nakama-server` | Bun-compiled server binary |
| `process.resourcesPath/server/packages/core` | `packages/core/` (no node_modules) |
| `process.resourcesPath/bun/bin/bun` | Official Bun runtime (download) |

At dev time, set `NAKAMA_DESKTOP_RESOURCES` to the `dist-server/` directory to
override the packaged resource root.

### Spawned process

The server binary is spawned with:

- `NODE_ENV=production`
- `NAKAMA_PORT` — dynamically assigned free port
- `NAKAMA_CONFIG_DIR` — `~/Library/Application Support/Nakama/nakama/` (macOS)
  or equivalent via `app.getPath("userData")`
- `DATABASE_URL` — SQLite at `<dataDir>/sqlite/nakama.sqlite`
- `NAKAMA_CORE_DIR` — bundled `packages/core` checkout (avoids require.resolve
  failure inside the compiled binary)
- `BUN_INSTALL_BIN` — bundled Bun runtime for spawned tool processes
- `BUN_INSTALL_GLOBAL_DIR` — `<dataDir>/.bun`

## Dev workflow

```bash
# 1. Install workspace deps (from repo root)
bun install

# 2. Build the TypeScript main process
cd apps/desktop && bun run build

# 3. Compile the server binary (macOS arm64)
bun run compile-server

# 4. (Optional) Download the bundled Bun runtime for tool-spawning
bun run scripts/fetch-runtime.ts

# 5. Run in development mode with local resources
NAKAMA_DESKTOP_RESOURCES=$(pwd)/dist-server bun run dev
```

To re-compile after server changes:

```bash
cd apps/desktop && bun run compile-server
```

To cross-compile for Windows:

```bash
bun run compile-server --target windows
```

## Packaging

```bash
# Unpackaged smoke build (no signing, no notarization)
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --config electron-builder.yml

# Full DMG + ZIP
CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist
```

## Not-yet-handled (issue #997 scope cuts)

- macOS code signing and notarisation
- Windows Authenticode signing
- Auto-update (electron-updater)
- Linux target (deb / AppImage / rpm)
- Deep links (`nakama://`)
- Launch at login
- Bundled skills ENOENT warning inside the compiled binary (non-fatal; server
  still works)
- SPA serving validation in packaged mode (should serve `apps/web/dist` via
  Hono static middleware, but not verified under the compiled binary)
