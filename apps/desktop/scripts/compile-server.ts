/**
 * compile-server.ts
 *
 * Builds the Nakama server into a standalone Bun binary and copies required
 * workspace trees for the desktop shell to ship as app resources.
 *
 * Usage:
 *   bun run scripts/compile-server.ts
 *   bun run scripts/compile-server.ts --target windows
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DESKTOP_DIR = resolve(__dirname, "..");
const MONOREPO_ROOT = resolve(DESKTOP_DIR, "../..");
const SERVER_DIR = join(MONOREPO_ROOT, "apps/server");
const DIST_SERVER = join(DESKTOP_DIR, "dist-server");
const PACKAGES_CORE = join(MONOREPO_ROOT, "packages/core");
const DIST_PACKAGES_CORE = join(DIST_SERVER, "packages/core");
const PACKAGES_DB = join(MONOREPO_ROOT, "packages/db");
const DIST_PACKAGES_DB = join(DIST_SERVER, "packages/db");
const BUN_VERSION = (process.env.BUN_VERSION ?? "latest").replace(/^v/, "");
const HAS_TARGET_FLAG = process.argv.indexOf("--target");
const TARGET_VAL =
  HAS_TARGET_FLAG === -1 ? undefined : process.argv[HAS_TARGET_FLAG + 1];
const BUN_TARGET =
  TARGET_VAL === "windows" ? "bun-windows-x64" : "bun-darwin-arm64";

// Clean previous build
if (existsSync(DIST_SERVER)) {
  rmSync(DIST_SERVER, { recursive: true });
}
mkdirSync(DIST_SERVER, { recursive: true });

console.log(`[compile-server] Building server binary (${BUN_TARGET})…`);

// Build with Bun's --compile flag. The binary goes into dist-server/.
const entry = join(SERVER_DIR, "src/index.ts");
const outfile = join(DIST_SERVER, "nakama-server");

const buildArgs = [
  "build",
  "--compile",
  entry,
  "--outfile",
  outfile,
  "--target",
  BUN_TARGET,
];

const buildProc = Bun.spawnSync(["bun", ...buildArgs], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    // Speed up: skip install if already built
    BUN_INSTALL: process.env.BUN_INSTALL,
  },
  stdio: ["inherit", "inherit", "inherit"],
});

if (buildProc.exitCode !== 0) {
  console.error("[compile-server] Build failed.");
  process.exit(buildProc.exitCode ?? 1);
}

console.log(`[compile-server] Binary created: ${outfile}`);

// Copy packages/core (excluding node_modules) for NAKAMA_CORE_DIR
console.log("[compile-server] Copying packages/core…");
mkdirSync(DIST_PACKAGES_CORE, { recursive: true });

function copyFilter(src: string): boolean {
  // Skip node_modules at any depth
  if (src.includes("node_modules")) {
    return false;
  }
  return true;
}

cpSync(PACKAGES_CORE, DIST_PACKAGES_CORE, {
  filter: copyFilter,
  force: true,
  recursive: true,
});

// packages/db ships for NAKAMA_SCHEMA_PATH — the bootstrap schema.sql is read
// from disk at runtime and compiled builds cannot read it from the bundle.
console.log("[compile-server] Copying packages/db…");
const DIST_PACKAGES_DB_DIR = join(DIST_PACKAGES_DB, "sql");
mkdirSync(DIST_PACKAGES_DB_DIR, { recursive: true });
cpSync(PACKAGES_DB, DIST_PACKAGES_DB, {
  filter: copyFilter,
  force: true,
  recursive: true,
});

console.log("[compile-server] Done. dist-server/ size:");
const { execSync } = await import("node:child_process");
execSync(`du -sh "${DIST_SERVER}"`, { stdio: "inherit" });
