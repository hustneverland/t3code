#!/usr/bin/env node
// Exports an Expo Updates v1 Android OTA bundle into ~/.t3/mobile-ota for Caddy to serve.

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repoRoot = NodePath.resolve(__dirname, "..");
const mobileDir = NodePath.join(repoRoot, "apps", "mobile");

const DEFAULT_BASE_URL = "https://t3-remote.shiyanjia.com:18443/ota";
const DEFAULT_OUT_DIR = NodePath.join(NodeOS.homedir(), ".t3", "mobile-ota");
const KEEP_RELEASES = 4;

// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone CLI script without Effect runtime.
const isWindows = process.platform === "win32";

const MIME_TYPES = {
  ".hbc": "application/javascript",
  ".js": "application/javascript",
  ".bundle": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
};

function parseArgs(argv) {
  const args = { baseUrl: DEFAULT_BASE_URL, outDir: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      args.baseUrl = argv[++i].replace(/\/+$/, "");
    } else if (arg === "--out-dir" && argv[i + 1]) {
      args.outDir = NodePath.resolve(argv[++i]);
    }
  }
  return args;
}

function loadEnvExample(envFile) {
  const result = {};
  if (!NodeFS.existsSync(envFile)) return result;
  for (const rawLine of NodeFS.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

function sha256Base64Url(filePath) {
  return NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(filePath)).digest("base64url");
}

function md5Hex(filePath) {
  return NodeCrypto.createHash("md5").update(NodeFS.readFileSync(filePath)).digest("hex");
}

function main() {
  const { baseUrl, outDir } = parseArgs(process.argv.slice(2));
  const publicEnv = loadEnvExample(NodePath.join(repoRoot, ".env.example"));
  const buildEnv = {
    ...publicEnv,
    ...process.env,
    APP_VARIANT: "production",
    T3CODE_ANDROID_PACKAGE: "io.github.hustneverland.t3code",
    T3CODE_MOBILE_VERSION: "2.3.1",
    T3CODE_MOBILE_APP_NAME: "星野",
    T3CODE_MOBILE_ICON_PRESET: "xingye",
    MOBILE_VERSION_POLICY: "appVersion",
    T3CODE_MOBILE_UPDATES_ENABLED: "1",
    T3CODE_MOBILE_UPDATES_URL: `${baseUrl}/manifest.json`,
    EXPO_NO_GIT_STATUS: "1",
    EXPO_NO_TYPESCRIPT_SETUP: "1",
  };

  const expoBin = NodePath.join(mobileDir, "node_modules", ".bin", isWindows ? "expo.cmd" : "expo");
  const runExpo = (expoArgs, capture = false) =>
    NodeChildProcess.execFileSync(expoBin, expoArgs, {
      cwd: mobileDir,
      env: buildEnv,
      shell: isWindows,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: capture ? "utf8" : undefined,
      maxBuffer: 32 * 1024 * 1024,
    });

  console.log("[ota] Resolving Expo config...");
  const expoConfig = JSON.parse(runExpo(["config", "--type", "public", "--json"], true));
  const runtimeVersion =
    typeof expoConfig.runtimeVersion === "string"
      ? expoConfig.runtimeVersion
      : String(expoConfig.version || "2.3.0");
  const scopeKey = `@hustneverland/${expoConfig.slug || "t3-code"}`;

  const tmpExportDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-mobile-ota-"));
  try {
    console.log(`[ota] Exporting Android JS/Hermes bundle (runtimeVersion=${runtimeVersion})...`);
    try {
      runExpo(["export", "--platform", "android", "--output-dir", tmpExportDir]);
    } catch (error) {
      // On Windows, Metro/native worker teardown can exit 0xC0000005 after writing all output.
      const metadataPath = NodePath.join(tmpExportDir, "metadata.json");
      const status = typeof error === "object" && error !== null ? error.status : undefined;
      if (!(isWindows && status === 3221225477 && NodeFS.existsSync(metadataPath))) {
        throw error;
      }
      console.warn("[ota] Ignoring Windows Metro teardown exit 0xC0000005 after completed export.");
    }

    const metadata = JSON.parse(
      NodeFS.readFileSync(NodePath.join(tmpExportDir, "metadata.json"), "utf8"),
    );
    const androidMeta = metadata?.fileMetadata?.android;
    if (!androidMeta?.bundle) {
      throw new Error("expo export did not produce fileMetadata.android.bundle");
    }
    const exportedBundlePath = NodePath.join(tmpExportDir, androidMeta.bundle);
    if (!NodeFS.existsSync(exportedBundlePath) || NodeFS.statSync(exportedBundlePath).size < 1024) {
      throw new Error(`Exported Android bundle is missing or truncated: ${exportedBundlePath}`);
    }

    const updateId = NodeCrypto.randomUUID();
    const createdAt = new Date().toISOString();
    const updateDir = NodePath.join(outDir, "updates", updateId);
    NodeFS.mkdirSync(updateDir, { recursive: true });

    const copyAsset = (relPath, extOverride, contentTypeOverride) => {
      const src = NodePath.join(tmpExportDir, relPath);
      const dst = NodePath.join(updateDir, relPath);
      NodeFS.mkdirSync(NodePath.dirname(dst), { recursive: true });
      NodeFS.copyFileSync(src, dst);
      const ext = extOverride ?? NodePath.extname(relPath);
      const normalizedExt = ext ? (ext.startsWith(".") ? ext : `.${ext}`) : "";
      const key = md5Hex(dst);
      const hash = sha256Base64Url(dst);
      const urlPath = relPath.split(NodePath.sep).join("/");
      return {
        hash,
        key,
        contentType:
          contentTypeOverride ??
          MIME_TYPES[normalizedExt.toLowerCase()] ??
          "application/octet-stream",
        ...(normalizedExt ? { fileExtension: normalizedExt } : {}),
        url: `${baseUrl}/updates/${updateId}/${urlPath}`,
      };
    };

    const launchAsset = copyAsset(
      androidMeta.bundle,
      NodePath.extname(androidMeta.bundle) || ".hbc",
      "application/javascript",
    );

    const seenKeys = new Set();
    const assets = [];
    for (const asset of androidMeta.assets ?? []) {
      const ext = asset.ext ? `.${String(asset.ext).replace(/^\./, "")}` : "";
      const entry = copyAsset(asset.path, ext);
      if (seenKeys.has(entry.key)) continue;
      seenKeys.add(entry.key);
      assets.push(entry);
    }

    const manifest = {
      id: updateId,
      createdAt,
      runtimeVersion,
      launchAsset,
      assets,
      metadata: {},
      extra: {
        scopeKey,
        expoClient: {
          ...expoConfig,
          hostUri: new URL(baseUrl).host,
        },
      },
    };

    const manifestDir = NodePath.join(outDir, "manifests", runtimeVersion);
    NodeFS.mkdirSync(manifestDir, { recursive: true });
    const manifestTmp = NodePath.join(manifestDir, `android.json.${process.pid}.tmp`);
    const manifestPath = NodePath.join(manifestDir, "android.json");
    NodeFS.writeFileSync(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    NodeFS.renameSync(manifestTmp, manifestPath);

    const updatesRoot = NodePath.join(outDir, "updates");
    const dirs = NodeFS.readdirSync(updatesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({
        name: d.name,
        mtimeMs: NodeFS.statSync(NodePath.join(updatesRoot, d.name)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of dirs.slice(KEEP_RELEASES)) {
      NodeFS.rmSync(NodePath.join(updatesRoot, stale.name), { recursive: true, force: true });
    }

    console.log("[ota] Published OTA update successfully!");
    console.log(`  id:             ${updateId}`);
    console.log(`  runtimeVersion: ${runtimeVersion}`);
    console.log(`  manifest:       ${manifestPath}`);
    console.log(`  launchAsset:    ${launchAsset.url}`);
    console.log(`  assets count:   ${assets.length}`);
  } finally {
    NodeFS.rmSync(tmpExportDir, { recursive: true, force: true });
  }
}

main();
