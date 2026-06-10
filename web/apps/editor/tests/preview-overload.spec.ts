// Preview overload guard regression spec (session 35 part 2).
//
// The crash this replaces: a huge nParticlesPerSecond (typed, Shift-×10'd,
// or chain-multiplied) drove unbounded heap growth in the live preview and
// hard-crashed the editor (OOM; host.log stopped mid-stream). The engine
// now enforces kMaxLivePreviewParticles / kMaxLiveEmitterInstances
// (engine.h): over budget it SUPPRESSES spawning, latches an overload
// flag surfaced on `stats/tick`, and resumes when the population decays
// (hysteresis at 90% of the cap).
//
// Test flow (one serial test — the phases share live-engine state):
//   1. Bomb: patch the first root emitter to rate=1e9, lifetime=5 and
//      spawn a preview instance via the manual SpawnerDriver (new
//      instances read the authored values at construction — the same
//      path the real crash took).
//   2. Assert a stats/tick arrives with overload=true and particles
//      within budget (the plateau replaces the old OOM death).
//   3. Restore: patch the rate back to 10 and push the change into the
//      LIVE instance via engine/action/on-particle-system-changed(-1)
//      (set-properties alone only writes the data model; live
//      EmitterInstances cache their spawn delay). Assert overload clears
//      once the population decays.
//   4. Cleanup (finally): restore original properties + spawner config,
//      engine/action/clear to kill the lingering preview instance so
//      later runs / specs aren't poisoned. The doc is never saved, so
//      there's no persistence risk.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

// Must match Engine::kMaxLivePreviewParticles (src/engine.h). Small
// slack: the stats counter is sampled at 4 Hz between frames.
const PARTICLE_BUDGET = 100_000;
const BUDGET_SLACK = 110_000;

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP: no browser contexts attached");
  const pages = context.pages();
  page = pages[0] ?? (await context.waitForEvent("page"));
  await page.waitForFunction(
    () => typeof (window as unknown as { bridge?: unknown }).bridge !== "undefined",
    null,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await browser?.close();
});

// Bridge request helper evaluated in the page. Kept as a string-free
// page.evaluate per the house CDP idiom (see emitter-tree.spec.ts).
async function bridgeRequest<T>(kind: string, params: unknown): Promise<T> {
  return page.evaluate(
    async ({ kind, params }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (window as any).bridge;
      return b.request({ kind, params });
    },
    { kind, params },
  ) as Promise<T>;
}

// Wait for the next stats/tick whose payload.overload matches `want`.
// Resolves null on timeout instead of throwing so assertions read better.
async function waitForOverload(
  want: boolean,
  timeoutMs: number,
): Promise<{ particles: number; overload: boolean } | null> {
  return page.evaluate(
    ({ want, timeoutMs }) =>
      new Promise<{ particles: number; overload: boolean } | null>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (window as any).bridge;
        const timer = setTimeout(() => {
          off();
          resolve(null);
        }, timeoutMs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = b.on("stats/tick", (e: any) => {
          if (e.payload.overload === want) {
            clearTimeout(timer);
            off();
            resolve({ particles: e.payload.particles, overload: e.payload.overload });
          }
        });
      }),
    { want, timeoutMs },
  );
}

test("huge spawn rate plateaus at the budget, latches overload, and recovers", async () => {
  // Phases: bomb (≤10 s) + decay (≤20 s) + cleanup — needs more than the
  // 30 s config default.
  test.setTimeout(90_000);

  // Defensive: make sure the 4 Hz stats stream is flowing (an earlier
  // crashed a11y spec could have left stats frozen).
  await bridgeRequest("stats/set-frozen", { frozen: false });

  // Locate the first root emitter and snapshot the fields we'll touch.
  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>(
    "emitters/list",
    {},
  );
  const targetId = tree.root.children[0]?.id;
  expect(targetId).not.toBeUndefined();

  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;

  const snapshot = await bridgeRequest<{ spawner: unknown }>(
    "engine/state/snapshot",
    {},
  );
  const origSpawner = snapshot.spawner;

  try {
    // ── Phase 1: arm the bomb ────────────────────────────────────────
    // rate=1e9 alone exceeds the 100k budget thousands of times over
    // every frame — no chain needed. lifetime=5 keeps the population
    // alive long enough for a deterministic plateau read at 4 Hz.
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 1_000_000_000, lifetime: 5, useBursts: false },
    });

    // Spawn one preview instance via the manual spawner — instances
    // constructed AFTER the patch read the huge rate (the real crash
    // path). maxLifetimeSec=0: no cap, so recovery below is attributable
    // to the rate restore, not lifetime expiry.
    await bridgeRequest("spawner/start", {
      mode: "manual",
      enabled: false,
      burstSize: 1,
      spacingSec: 0,
      intervalSec: 10,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      maxLifetimeSec: 0,
      jitterPosition: [0, 0, 0],
      jitterVelocity: [0, 0, 0],
    });
    await bridgeRequest("spawner/trigger", {});

    // ── Phase 2: the engine survives and latches ─────────────────────
    const overloaded = await waitForOverload(true, 10_000);
    expect(overloaded, "expected a stats/tick with overload=true").not.toBeNull();
    expect(overloaded!.overload).toBe(true);
    expect(overloaded!.particles).toBeLessThanOrEqual(BUDGET_SLACK);

    // The editor is still responsive: a bridge round-trip completes.
    // (Pre-guard, the process was dead by now.)
    const alive = await bridgeRequest<{ selectedEmitterId: number | null }>(
      "engine/state/snapshot",
      {},
    );
    expect(alive).toBeTruthy();

    // ── Phase 3: lower the rate → overload clears ────────────────────
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 10, lifetime: 1 },
    });
    // Push the new values into the LIVE EmitterInstance (it caches its
    // spawn delay at construction / on this notification).
    await bridgeRequest("engine/action/on-particle-system-changed", { track: -1 });

    // Population decays as the 5 s-lifetime particles die; spawning
    // resumes below 90% of the cap and the latch drops.
    const recovered = await waitForOverload(false, 20_000);
    expect(recovered, "expected overload to clear after the rate drop").not.toBeNull();
    expect(recovered!.overload).toBe(false);
  } finally {
    // ── Phase 4: cleanup even on failure ─────────────────────────────
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: {
        nParticlesPerSecond: orig.nParticlesPerSecond,
        lifetime: orig.lifetime,
        useBursts: orig.useBursts,
      },
    });
    await bridgeRequest("engine/action/on-particle-system-changed", { track: -1 });
    await bridgeRequest("spawner/stop", {});
    if (origSpawner) {
      await bridgeRequest("spawner/start", origSpawner);
    }
    // Kill the lingering preview instance (and reset the budget latch).
    await bridgeRequest("engine/action/clear", {});
  }
});
