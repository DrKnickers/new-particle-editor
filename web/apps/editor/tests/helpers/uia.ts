import { spawn } from "node:child_process";
import * as path from "node:path";
import type { UIANode } from "./a11y-normalizer";

// Path to the T3 C++ inspector executable.
// tests/helpers/ → 5 levels of ".." → repo root → x64/<Debug|Release>/
const INSPECTOR_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "x64",
  process.env.A11Y_BUILD_CONFIG ?? "Debug",
  "uia_inspector.exe"
);

export async function captureUIA(
  hwnd: bigint | number,
  surfaceId: string,
  options?: { depth?: number; timeoutMs?: number }
): Promise<UIANode> {
  const hex = "0x" + BigInt(hwnd).toString(16);
  const args = [
    "--hwnd", hex,
    "--capture", surfaceId,
    "--depth", String(options?.depth ?? 8),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(INSPECTOR_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(
        `uia_inspector timeout (${options?.timeoutMs ?? 5000}ms) for surface=${surfaceId}`
      ));
    }, options?.timeoutMs ?? 5000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(
          `uia_inspector exited ${code} for surface=${surfaceId}: ${stderr}`
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as UIANode);
      } catch (e) {
        reject(new Error(
          `uia_inspector produced invalid JSON for surface=${surfaceId}: ` +
          `${(e as Error).message}\nstdout: ${stdout.slice(0, 500)}`
        ));
      }
    });
  });
}

export async function discoverHostHwnd(
  options?: { processName?: string; timeoutMs?: number }
): Promise<bigint> {
  const procName = options?.processName ?? "ParticleEditor";
  const cmd =
    `(Get-Process ${procName} -ErrorAction SilentlyContinue | ` +
    `Where-Object MainWindowHandle -ne 0 | ` +
    `Select-Object -First 1).MainWindowHandle`;
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      ps.kill();
      reject(new Error(`discoverHostHwnd timeout for process ${procName}`));
    }, options?.timeoutMs ?? 5000);
    ps.stdout.on("data", (c) => { out += c.toString("utf8"); });
    ps.stderr.on("data", (c) => { err += c.toString("utf8"); });
    ps.on("close", () => {
      clearTimeout(t);
      const v = out.trim();
      if (!v) {
        reject(new Error(
          `Could not find ${procName} HWND. ` +
          `Is the editor running? stderr: ${err}`
        ));
      } else {
        resolve(BigInt(v));
      }
    });
  });
}
