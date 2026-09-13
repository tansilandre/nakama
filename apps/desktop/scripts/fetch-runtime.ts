/**
 * fetch-runtime.ts
 *
 * Downloads the official Bun runtime binary matching the locally-installed
 * version and places it under dist-server/bun/ so electron-builder can
 * bundle it as an app resource.
 *
 * The spawned server needs a Bun binary in PATH (via BUN_INSTALL_BIN) to
 * run external tool processes (custom JS/Python tools).
 *
 * Usage:
 *   bun run scripts/fetch-runtime.ts
 *   bun run scripts/fetch-runtime.ts --target windows
 *
 * Never commit the downloaded binary.
 */

import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DESKTOP_DIR = resolve(__dirname, "..");
const DIST_SERVER = join(DESKTOP_DIR, "dist-server");
const BUN_DIR = join(DIST_SERVER, "bun");
const BUN_BIN_DIR = join(BUN_DIR, "bin");

const HAS_TARGET_FLAG = process.argv.indexOf("--target");
const TARGET_VAL =
  HAS_TARGET_FLAG === -1 ? undefined : process.argv[HAS_TARGET_FLAG + 1];
const IS_WINDOWS = TARGET_VAL === "windows";
const PLATFORM_TAG = IS_WINDOWS ? "windows-x64" : "darwin-arm64";
const ARCHIVE_NAME = `bun-${PLATFORM_TAG}.zip`;

const { stdout: versionOut } = Bun.spawnSync(["bun", "--version"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const BUN_VERSION = versionOut.toString().trim();

if (!BUN_VERSION) {
  console.error("[fetch-runtime] Could not determine local bun --version");
  process.exit(1);
}

const DOWNLOAD_URL = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${ARCHIVE_NAME}`;

async function main(): Promise<void> {
  // Clean previous runtime
  if (existsSync(BUN_DIR)) {
    rmSync(BUN_DIR, { recursive: true });
  }
  mkdirSync(BUN_BIN_DIR, { recursive: true });

  console.log(
    `[fetch-runtime] Downloading Bun v${BUN_VERSION} (${PLATFORM_TAG})…`
  );
  console.log(`  ${DOWNLOAD_URL}`);

  const response = await fetch(DOWNLOAD_URL);

  if (!response.ok) {
    console.error(
      `[fetch-runtime] Download failed: ${response.status} ${response.statusText}`
    );
    console.error(
      "  The binary is only needed for packaging. You can continue developing"
    );
    console.error(
      "  with the system Bun (BUN_INSTALL_BIN is set at dev time)."
    );
    process.exit(1);
  }

  const tmpZip = join(DIST_SERVER, `_bun-${PLATFORM_TAG}.zip`);
  const fileStream = createWriteStream(tmpZip);
  await pipeline(response.body!, fileStream);

  // Extract using Bun's built-in unzip
  const extract = Bun.spawnSync(["unzip", "-o", tmpZip, "-d", BUN_DIR], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  if (extract.exitCode !== 0) {
    console.error("[fetch-runtime] Extraction failed.");
    process.exit(1);
  }

  // The archive contains a bun-{platform}/ directory; move the binary up
  const extractedDir = join(BUN_DIR, `bun-${PLATFORM_TAG}`);
  if (existsSync(extractedDir)) {
    const { renameSync } = await import("node:fs");
    const binName = IS_WINDOWS ? "bun.exe" : "bun";
    const srcBin = join(extractedDir, binName);
    const dstBin = join(BUN_BIN_DIR, binName);
    if (existsSync(srcBin)) {
      renameSync(srcBin, dstBin);
    }
    // Remove the extracted directory and any leftover
    rmSync(extractedDir, { recursive: true });
  }

  // Clean up the archive
  rmSync(tmpZip);

  // Make executable
  if (!IS_WINDOWS) {
    const { chmodSync } = await import("node:fs");
    chmodSync(join(BUN_BIN_DIR, "bun"), 0o755);
  }

  console.log(`[fetch-runtime] Bun runtime extracted to ${BUN_BIN_DIR}`);
  const { execSync } = await import("node:child_process");
  execSync(`ls -la "${BUN_BIN_DIR}"`, { stdio: "inherit" });
}

await main();
