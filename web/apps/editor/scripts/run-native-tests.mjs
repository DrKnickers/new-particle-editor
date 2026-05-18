// Task 2.2 test harness: orchestrates the native bridge Playwright run.
//
// 1. Kill any stale ParticleEditor.exe (best-effort).
// 2. Launch x64\Debug\ParticleEditor.exe --new-ui --test-host.
// 3. Poll http://localhost:9222/json/version until CDP is ready
//    (≤ 30 s; WebView2 init plus DPI/COM startup can take 5–10 s).
// 4. Spawn Playwright against tests/bridge-native.spec.ts.
// 5. Tear down the host and exit with Playwright's exit code.
//
// Cleanup runs on success, failure, AND uncaught throws — the binary
// is single-instance so leaving it around blocks the next run.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorDir = resolve(__dirname, "..");
const repoRoot = resolve(__dirname, "../../../..");
const exe = join(repoRoot, "x64", "Debug", "ParticleEditor.exe");

async function probeCdp() {
  try {
    const res = await fetch("http://localhost:9222/json/version");
    return res.ok;
  } catch {
    return false;
  }
}

function killAny() {
  return new Promise((resolve) => {
    const p = spawn("taskkill", ["/F", "/IM", "ParticleEditor.exe"], {
      stdio: "ignore",
      shell: false,
    });
    p.on("exit", () => resolve());
    p.on("error", () => resolve()); // taskkill missing → nothing to clean
  });
}

async function main() {
  await killAny();
  // Give Windows a moment to release file locks.
  await sleep(300);

  console.log(`[run-native-tests] Launching ${exe} --new-ui --test-host ...`);
  const child = spawn(exe, ["--new-ui", "--test-host"], {
    cwd: repoRoot,
    stdio: "inherit",
    detached: false,
  });

  let childExited = false;
  child.on("exit", (code, signal) => {
    childExited = true;
    console.log(`[run-native-tests] host process exited (code=${code}, signal=${signal})`);
  });

  let cdpUp = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (childExited) {
      throw new Error("Host process exited before CDP came up");
    }
    if (await probeCdp()) {
      cdpUp = true;
      break;
    }
    await sleep(500);
  }
  if (!cdpUp) {
    console.error("[run-native-tests] CDP did not come up at http://localhost:9222 within 30s");
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await killAny();
    process.exit(1);
  }
  console.log("[run-native-tests] CDP ready, running Playwright spec ...");

  // On Windows the playwright .bin entry is a .CMD shim; node's spawn
  // refuses to launch .CMD without shell:true, so use the JS cli entry
  // directly via node to keep the spawn cross-platform and shell-free.
  const playwrightCli = join(editorDir, "node_modules", "@playwright", "test",
    "cli.js");
  const pwExit = await new Promise((resolve) => {
    const pw = spawn(process.execPath, [
      playwrightCli, "test",
      "tests/bridge-native.spec.ts",
      "tests/background-picker.spec.ts",
      "tests/app-shell.spec.ts",
      "tests/toolbar.spec.ts",
      "tests/menu-bar.spec.ts",
      "tests/primitives.spec.ts",
      "tests/dialogs.spec.ts",
      "tests/tools.spec.ts",
      "tests/file-ops.spec.ts",
      "tests/spawner-import-mod.spec.ts",
      "tests/host-state-plumbing.spec.ts",
      "tests/render-loop.spec.ts",
      "tests/viewport-camera.spec.ts",
      "tests/emitter-tree.spec.ts",
      "tests/emitter-mutations.spec.ts",
      "tests/emitter-multi-mutations.spec.ts",
      "tests/emitter-drag.spec.ts",
      "tests/emitter-keyboard.spec.ts",
    ], {
      cwd: editorDir,
      stdio: "inherit",
      shell: false,
    });
    pw.on("exit", (code) => resolve(code ?? 1));
    pw.on("error", (err) => {
      console.error("[run-native-tests] failed to spawn playwright:", err);
      resolve(1);
    });
  });

  try {
    child.kill();
  } catch {
    /* ignore */
  }
  await sleep(500);
  await killAny();

  process.exit(pwExit);
}

main().catch(async (err) => {
  console.error("[run-native-tests]", err);
  await killAny();
  process.exit(1);
});
