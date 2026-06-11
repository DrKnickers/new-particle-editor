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
//
// A second test exercises the OTHER refusal path: a death child under
// overload makes every particle death call SpawnEmitter, which the
// instance budget (kMaxLiveEmitterInstances) refuses with nullptr —
// KillParticle must tolerate that thousands of times per second.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

// The overload guard cap is now runtime-configurable (engine default
// 10_000, user-adjustable). The two 1e9-bomb tests pin the cap explicitly
// at the top of each test (engine/set/overload-guard) so they don't
// depend on the default. The slack stays 110_000 — well above any pinned
// cap below — since the stats counter is sampled at 4 Hz between frames.
// In practice a SINGLE emitter plateaus far lower (the per-instance
// uint16 index cap, 16,383) — the assertion only needs to prove the
// population is bounded, not which ceiling bit first.
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

// Best-effort cleanup wrapper for finally blocks: if the host died or
// wedged, a throwing cleanup call would REPLACE the original assertion
// error with an unhelpful bridge error. Log and continue instead.
async function cleanupStep(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.log(`[preview-overload] cleanup step '${label}' failed (ignored):`, String(err));
  }
}

// Wait for the next stats/tick whose payload.overload matches `want`.
// Resolves { hit: null } on timeout instead of throwing, carrying every
// observed tick so a failure message shows exactly what the host
// reported during the window.
type Tick = { fps: number; particles: number; instances: number; overload: boolean };
async function waitForOverload(
  want: boolean,
  timeoutMs: number,
): Promise<{ hit: Tick | null; seen: Tick[] }> {
  return page.evaluate(
    ({ want, timeoutMs }) =>
      new Promise<{ hit: Tick | null; seen: Tick[] }>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (window as any).bridge;
        const seen: Tick[] = [];
        const timer = setTimeout(() => {
          off();
          resolve({ hit: null, seen });
        }, timeoutMs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = b.on("stats/tick", (e: any) => {
          seen.push(e.payload);
          if (e.payload.overload === want) {
            clearTimeout(timer);
            off();
            resolve({ hit: e.payload, seen });
          }
        });
      }),
    { want, timeoutMs },
  );
}

// Wait for the next `engine/overload/refused` event (the preemptive
// estimate gate's one-shot refusal). Mirrors waitForOverload: subscribes
// in-page, resolves the payload on the first event, or null on timeout
// (so a missing event surfaces as a clear assertion rather than a hang).
type Refusal = { estimated: number; cap: number; attemptedCount: number };
async function waitForRefusal(timeoutMs: number): Promise<Refusal | null> {
  return page.evaluate(
    ({ timeoutMs }) =>
      new Promise<Refusal | null>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (window as any).bridge;
        const timer = setTimeout(() => {
          off();
          resolve(null);
        }, timeoutMs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = b.on("engine/overload/refused", (e: any) => {
          clearTimeout(timer);
          off();
          resolve(e.payload as Refusal);
        });
      }),
    { timeoutMs },
  );
}

// Count `engine/overload/refused` events over a fixed observation window
// (used by the churn-stop spec to prove EXACTLY one refusal across many
// spawner intervals). Always runs the full window — never short-circuits
// — so an over-firing gate is caught.
async function countRefusals(windowMs: number): Promise<number> {
  return page.evaluate(
    ({ windowMs }) =>
      new Promise<number>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (window as any).bridge;
        let count = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = b.on("engine/overload/refused", () => {
          count += 1;
        });
        setTimeout(() => {
          off();
          resolve(count);
        }, windowMs);
      }),
    { windowMs },
  );
}

// Read the live placed-instance count from the next stats/tick (the
// snapshot has no instance count; stats/tick.payload.instances does).
// Resolves -1 on timeout so a stalled stats stream is distinguishable
// from a genuine 0.
async function readInstanceCount(timeoutMs: number): Promise<number> {
  return page.evaluate(
    ({ timeoutMs }) =>
      new Promise<number>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (window as any).bridge;
        const timer = setTimeout(() => {
          off();
          resolve(-1);
        }, timeoutMs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = b.on("stats/tick", (e: any) => {
          clearTimeout(timer);
          off();
          resolve(e.payload.instances as number);
        });
      }),
    { timeoutMs },
  );
}

// Shared manual-spawner config for the gate specs: burstSize 1 so each
// trigger places exactly one instance, no auto interval (enabled:false,
// manual mode), no lifetime cap (maxLifetimeSec:0) so clears are
// attributable to the gate, not lifetime expiry.
const MANUAL_SPAWNER_1 = {
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
};

test("huge spawn rate plateaus at the budget, latches overload, and recovers", async () => {
  // Phases: bomb (≤10 s) + decay (≤20 s) + cleanup — needs more than the
  // 30 s config default. The generous ceiling also covers inflated
  // bridge round-trip latency while the host is simulating tens of
  // thousands of Debug-build particles (observed: ~70 s total in a
  // full-harness run whose document carried an extra emitter).
  test.setTimeout(150_000);

  // Defensive: make sure the 4 Hz stats stream is flowing (an earlier
  // crashed a11y spec could have left stats frozen).
  await bridgeRequest("stats/set-frozen", { frozen: false });
  // Defensive: unpause the preview clock. The a11y composition specs
  // pause it in beforeEach (engine/set/paused: true) and their afterAll
  // cleanup unfreezes stats + file/new but does NOT unpause — with the
  // clock frozen no spawn round ever fires, so overload could never
  // latch (bit this spec on its first full-harness run).
  await bridgeRequest("engine/set/paused", { paused: false });
  // [hard-guard] Reset the preemptive estimate gate to inert (0). Earlier
  // NEW specs in this shared-host file push a non-zero estimate; without
  // this reset the bomb's preview instance could be refused by the
  // estimate gate before the runtime backstop ever latches. 0 = no
  // estimate = gate inert, so this spec exercises ONLY the backstop.
  await bridgeRequest("engine/set/estimated-load", { perInstance: 0 });

  // [guard-config] Pin the cap explicitly so this spec doesn't depend on
  // the engine default — and pin it LOW (1_000, the clamp minimum). The
  // banner/latch/recovery behaviour under test is cap-independent, and
  // the 1e9 bomb below plateaus AT the cap: heavy plateaus ground the
  // Debug test host under full-harness pressure (a 100k plateau
  // OOM-crashed it 2/2; even the old 15k pin produced repeated
  // host-death flakes at the tail of the run). 1k keeps the bomb cheap
  // while still proving plateau + latch + recovery.
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });

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
    // Diagnostics on failure: show what the host reported (paused state,
    // patched props, and every tick observed in the window).
    if (overloaded.hit === null) {
      const snap = await bridgeRequest<{ paused: boolean }>("engine/state/snapshot", {});
      const props = await bridgeRequest<{ properties: unknown }>(
        "emitters/get-properties",
        { id: targetId },
      );
      console.log("[preview-overload] paused:", JSON.stringify(snap.paused));
      console.log("[preview-overload] target props:", JSON.stringify(props.properties));
      console.log("[preview-overload] ticks seen:", JSON.stringify(overloaded.seen));
    }
    expect(overloaded.hit, "expected a stats/tick with overload=true").not.toBeNull();
    expect(overloaded.hit!.overload).toBe(true);
    expect(overloaded.hit!.particles).toBeLessThanOrEqual(BUDGET_SLACK);

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
    if (recovered.hit === null) {
      console.log("[preview-overload] recovery ticks seen:", JSON.stringify(recovered.seen));
    }
    expect(recovered.hit, "expected overload to clear after the rate drop").not.toBeNull();
    expect(recovered.hit!.overload).toBe(false);
  } finally {
    // ── Phase 4: cleanup even on failure (best-effort — see cleanupStep) ──
    await cleanupStep("restore-properties", () =>
      bridgeRequest("emitters/set-properties", {
        id: targetId,
        patch: {
          nParticlesPerSecond: orig.nParticlesPerSecond,
          lifetime: orig.lifetime,
          useBursts: orig.useBursts,
        },
      }),
    );
    await cleanupStep("push-live", () =>
      bridgeRequest("engine/action/on-particle-system-changed", { track: -1 }),
    );
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    // Kill the lingering preview instance (and reset the budget latch).
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    // Restore the engine default cap for any later run / spec.
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("death-child spawns are refused under overload and the editor survives", async () => {
  // Latch (≤15 s) + a short soak + cleanup, in a Debug build.
  test.setTimeout(90_000);

  // Defensive (same as test 1): stats flowing, clock running.
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  // [hard-guard] Reset the preemptive estimate gate to inert (0) — same
  // reason as the first bomb spec: earlier NEW specs push a non-zero
  // estimate, and this spec must exercise ONLY the runtime backstop.
  await bridgeRequest("engine/set/estimated-load", { perInstance: 0 });

  // [guard-config] Pin the cap explicitly so this spec doesn't depend on
  // the engine default — pinned LOW (1_000) like test 1: heavy plateaus
  // ground the Debug host under full-harness pressure; the refusal
  // behaviour under test is cap-independent (the instance ceiling
  // derives as cap/20 = 50, so the death-child storm hits refusals
  // even sooner).
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });

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

  let childId: number | null = null;
  try {
    // ── Phase 1: wire a death child onto the root emitter ────────────
    // Every parent-particle death now calls SpawnEmitter for the child;
    // past kMaxLiveEmitterInstances (5,000) that returns nullptr — the
    // refusal path inside EmitterInstance::KillParticle.
    const added = await bridgeRequest<{ newId: number }>("emitters/add-death-child", {
      parentId: targetId,
    });
    childId = added.newId;
    // newId: -1 means the death slot was already filled — the boot doc
    // shouldn't have one; fail loudly rather than testing nothing.
    expect(childId, "add-death-child refused (slot already filled?)").toBeGreaterThanOrEqual(0);

    // Child: moderate rate so the (≤5k) successfully spawned death
    // children don't blow the particle budget on their own.
    await bridgeRequest("emitters/set-properties", {
      id: childId,
      patch: { nParticlesPerSecond: 100, lifetime: 0.5, useBursts: false },
    });
    // Parent: high rate + SHORT lifetime so deaths fire constantly
    // (~50k deaths/s at steady state — each one a SpawnEmitter attempt,
    // refused once the instance cap is pinned).
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 50_000, lifetime: 0.2, useBursts: false },
    });

    // Spawn one preview instance reading the patched values (same
    // manual-spawner path as test 1).
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

    // ── Phase 2: instance-budget refusals latch overload ─────────────
    const overloaded = await waitForOverload(true, 15_000);
    if (overloaded.hit === null) {
      const snap = await bridgeRequest<{ paused: boolean }>("engine/state/snapshot", {});
      console.log("[preview-overload] death-child paused:", JSON.stringify(snap.paused));
      console.log("[preview-overload] death-child ticks seen:", JSON.stringify(overloaded.seen));
    }
    expect(overloaded.hit, "expected overload=true via death-child instance refusals").not.toBeNull();
    expect(overloaded.hit!.overload).toBe(true);
    expect(overloaded.hit!.particles).toBeLessThanOrEqual(BUDGET_SLACK);

    // ── Phase 3: soak the refusal path, then prove responsiveness ────
    // ~5 s pinned at the instance cap ≈ tens of thousands of refused
    // KillParticle→SpawnEmitter calls. The editor must keep answering.
    await page.waitForTimeout(5_000);
    const alive = await bridgeRequest<{ selectedEmitterId: number | null }>(
      "engine/state/snapshot",
      {},
    );
    expect(alive).toBeTruthy();
  } finally {
    // ── Cleanup even on failure (best-effort — see cleanupStep) ──────
    await cleanupStep("restore-properties", () =>
      bridgeRequest("emitters/set-properties", {
        id: targetId,
        patch: {
          nParticlesPerSecond: orig.nParticlesPerSecond,
          lifetime: orig.lifetime,
          useBursts: orig.useBursts,
        },
      }),
    );
    if (childId !== null) {
      // Removes the death child from the doc AND kills its live
      // instances (RemoveEmitter path — including their particle
      // accounting).
      await cleanupStep("delete-death-child", () =>
        bridgeRequest("emitters/delete", { id: childId }),
      );
    }
    await cleanupStep("push-live", () =>
      bridgeRequest("engine/action/on-particle-system-changed", { track: -1 }),
    );
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    // Kill the lingering preview instance (and reset the budget latch).
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    // Restore the engine default cap for any later run / spec.
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("a lowered cap bounds the plateau at the configured value", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 5_000 });

  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>("emitters/list", {});
  const targetId = tree.root.children[0]?.id;
  expect(targetId).not.toBeUndefined();
  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;
  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 1_000_000_000, lifetime: 5, useBursts: false },
    });
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

    const overloaded = await waitForOverload(true, 10_000);
    if (overloaded.hit === null) {
      console.log("[preview-overload] lowered-cap ticks seen:", JSON.stringify(overloaded.seen));
    }
    expect(overloaded.hit, "expected a stats/tick with overload=true").not.toBeNull();
    // 4 Hz sampling slack on a 5k cap: one inter-tick round can overshoot
    // a little; 6k proves the 100k ceiling is NOT in play.
    for (const t of overloaded.seen) expect(t.particles).toBeLessThanOrEqual(6_000);
  } finally {
    await cleanupStep("restore-properties", () =>
      bridgeRequest("emitters/set-properties", {
        id: targetId,
        patch: {
          nParticlesPerSecond: orig.nParticlesPerSecond,
          lifetime: orig.lifetime,
          useBursts: orig.useBursts,
        },
      }),
    );
    await cleanupStep("push-live", () =>
      bridgeRequest("engine/action/on-particle-system-changed", { track: -1 }),
    );
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("lowering the cap mid-run suppresses and decays to the new ceiling", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  // Start cap kept SMALL (2k): the mechanics under test only need
  // start > lowered, and a big Debug plateau (the original 50k) grinds
  // the test host — the same pressure class as the bomb specs, which
  // pin 1k for the same reason.
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 2_000 });

  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>("emitters/list", {});
  const targetId = tree.root.children[0]?.id;
  expect(targetId).not.toBeUndefined();
  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;
  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    // lifetime 2: faster natural decay keeps the test quick.
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 1_000_000_000, lifetime: 2, useBursts: false },
    });
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
    const armed = await waitForOverload(true, 10_000);
    if (armed.hit === null) {
      console.log("[preview-overload] mid-run arm ticks seen:", JSON.stringify(armed.seen));
    }
    expect(armed.hit, "expected overload=true before lowering the cap").not.toBeNull();

    await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });
    const decayed = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = (window as any).bridge;
          const timer = setTimeout(() => {
            off();
            resolve(false);
          }, 15_000);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const off = b.on("stats/tick", (e: any) => {
            if (e.payload.particles <= 1_000) {
              clearTimeout(timer);
              off();
              resolve(true);
            }
          });
        }),
    );
    expect(decayed, "expected population to decay to the lowered 1k cap").toBe(true);
  } finally {
    await cleanupStep("restore-properties", () =>
      bridgeRequest("emitters/set-properties", {
        id: targetId,
        patch: {
          nParticlesPerSecond: orig.nParticlesPerSecond,
          lifetime: orig.lifetime,
          useBursts: orig.useBursts,
        },
      }),
    );
    await cleanupStep("push-live", () =>
      bridgeRequest("engine/action/on-particle-system-changed", { track: -1 }),
    );
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("disabled guard lets the population exceed the cap with no overload latch", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  // Low cap + disabled: if the guard were active the population would pin
  // at 1k; exceeding it proves uncapped. MODEST rate (1k/s × 5s ≈ 5k peak)
  // — deliberately NOT the 1e9 bomb, and kept an order of magnitude under
  // the old 4k/s ≈ 20k version: Debug-host pressure at the tail of the
  // full run is the harness's failure mode.
  await bridgeRequest("engine/set/overload-guard", { enabled: false, maxParticles: 1_000 });

  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>("emitters/list", {});
  const targetId = tree.root.children[0]?.id;
  expect(targetId).not.toBeUndefined();
  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;
  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 1_000, lifetime: 5, useBursts: false },
    });
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

    const result = await page.evaluate(
      () =>
        new Promise<{ peak: number; latched: boolean }>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = (window as any).bridge;
          let peak = 0;
          let latched = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const off = b.on("stats/tick", (e: any) => {
            peak = Math.max(peak, e.payload.particles);
            if (e.payload.overload) latched = true;
          });
          setTimeout(() => {
            off();
            resolve({ peak, latched });
          }, 8_000);
        }),
    );
    expect(result.peak, "expected the uncapped population to exceed the 1k cap").toBeGreaterThan(1_500);
    expect(result.latched, "expected no overload latch while the guard is disabled").toBe(false);
  } finally {
    await cleanupStep("restore-properties", () =>
      bridgeRequest("emitters/set-properties", {
        id: targetId,
        patch: {
          nParticlesPerSecond: orig.nParticlesPerSecond,
          lifetime: orig.lifetime,
          useBursts: orig.useBursts,
        },
      }),
    );
    await cleanupStep("push-live", () =>
      bridgeRequest("engine/action/on-particle-system-changed", { track: -1 }),
    );
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// Preemptive estimate-gate specs (overload hard-guard, session 38).
//
// These exercise the NEW gate: the web pushes a per-instance alive
// estimate (engine/set/estimated-load); the engine refuses a placement
// (and clears the whole preview) when (placed+1)×estimate exceeds the
// cap, or clears retroactively when an estimate push pushes
// placed×estimate over. Refusals surface as engine/overload/refused.
//
// nullptr ⟺ refusal invariant: SpawnParticleSystem returns nullptr ONLY
// on a gate refusal, so "no instance placed + a refusal event" is the
// observable proof the gate fired.
//
// Every spec restores: guard 10k + estimate 0 + engine/action/clear in
// finally, so the gate is inert for the bomb specs that share this host.
// All caps ≤ 2k (#134 LOW-cap discipline).
// ─────────────────────────────────────────────────────────────────────

test("cumulative spawn gate refuses the over-cap placement and clears the preview", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });
  // estimate 400: 1×400=400 ok, 2×400=800 ok, 3×400=1200 > 1000 → refuse.
  await bridgeRequest("engine/set/estimated-load", { perInstance: 400 });

  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    await bridgeRequest("spawner/start", MANUAL_SPAWNER_1);
    // Two placements: 1×400 then 2×400 — both within the 1k cap.
    await bridgeRequest("spawner/trigger", {});
    await bridgeRequest("spawner/trigger", {});

    // The third placement is refused: 3×400 = 1200 > 1000. Arm the waiter
    // BEFORE the trigger so the one-shot event isn't missed.
    const refusalP = waitForRefusal(8_000);
    await bridgeRequest("spawner/trigger", {});
    const refusal = await refusalP;
    expect(refusal, "expected an engine/overload/refused event on the 3rd placement").not.toBeNull();
    expect(refusal!.estimated).toBeGreaterThan(1_000);
    expect(refusal!.cap).toBe(1_000);

    // Clear-on-refusal: the whole preview is gone (count 0).
    const instances = await readInstanceCount(5_000);
    expect(instances, "expected the preview cleared to 0 instances after refusal").toBe(0);

    // The editor is alive: a follow-up bridge request resolves.
    const list = await bridgeRequest<{ root: unknown }>("emitters/list", {});
    expect(list).toBeTruthy();
  } finally {
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("estimate-reset", () =>
      bridgeRequest("engine/set/estimated-load", { perInstance: 0 }),
    );
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("edit-time estimate push over the cap clears the already-placed preview", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });
  await bridgeRequest("engine/set/estimated-load", { perInstance: 400 });

  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    await bridgeRequest("spawner/start", MANUAL_SPAWNER_1);
    // Two placements at estimate 400 → 2×400 = 800, within the 1k cap,
    // no refusal.
    await bridgeRequest("spawner/trigger", {});
    await bridgeRequest("spawner/trigger", {});

    // A parameter edit raises the estimate to 600: 2×600 = 1200 > 1000.
    // The edit-time check inside SetEstimatedLoad clears the preview and
    // records the refusal. Arm the waiter before the push.
    const refusalP = waitForRefusal(8_000);
    await bridgeRequest("engine/set/estimated-load", { perInstance: 600 });
    const refusal = await refusalP;
    expect(refusal, "expected an engine/overload/refused event from the edit-time check").not.toBeNull();
    expect(refusal!.estimated).toBeGreaterThan(1_000);
    expect(refusal!.cap).toBe(1_000);

    const instances = await readInstanceCount(5_000);
    expect(instances, "expected the preview cleared to 0 after the edit-time check").toBe(0);
  } finally {
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("estimate-reset", () =>
      bridgeRequest("engine/set/estimated-load", { perInstance: 0 }),
    );
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("a single instance over the cap is refused on every retry (no lock-out)", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });
  // 1×1500 = 1500 > 1000 → even a single placement is refused.
  await bridgeRequest("engine/set/estimated-load", { perInstance: 1_500 });

  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    await bridgeRequest("spawner/start", MANUAL_SPAWNER_1);

    // First trigger → refused. (After a clear-on-refusal the count is 0,
    // so the next trigger re-checks 0+1 from scratch — proving there is
    // no persistent locked state.)
    const r1P = waitForRefusal(8_000);
    await bridgeRequest("spawner/trigger", {});
    const r1 = await r1P;
    expect(r1, "expected the first over-cap placement to be refused").not.toBeNull();
    expect(r1!.estimated).toBeGreaterThan(1_000);

    // Second trigger → refused AGAIN (a distinct event). No lock-out.
    const r2P = waitForRefusal(8_000);
    await bridgeRequest("spawner/trigger", {});
    const r2 = await r2P;
    expect(r2, "expected the retry to be refused again (no lock-out state)").not.toBeNull();
    expect(r2!.estimated).toBeGreaterThan(1_000);
  } finally {
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("estimate-reset", () =>
      bridgeRequest("engine/set/estimated-load", { perInstance: 0 }),
    );
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("an auto spawner refused over-cap fires one banner and self-disables", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 1_000 });
  await bridgeRequest("engine/set/estimated-load", { perInstance: 1_500 });

  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    // Auto/interval spawner with a SHORT interval: without the churn stop
    // it would refuse-and-clear every interval, producing one banner per
    // cycle. The driver must self-disable after the FIRST refusal.
    await bridgeRequest("spawner/start", {
      mode: "auto",
      enabled: true,
      burstSize: 1,
      spacingSec: 0,
      intervalSec: 0.25,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      maxLifetimeSec: 0,
      jitterPosition: [0, 0, 0],
      jitterVelocity: [0, 0, 0],
    });

    // Observe across many intervals (3s ≫ 0.25s interval): exactly one
    // refusal proves the driver disabled itself after the first.
    const count = await countRefusals(3_000);
    expect(count, "expected EXACTLY one refusal across the multi-interval window").toBe(1);

    // The driver self-disabled: the snapshot's spawner reports enabled:false.
    const after = await bridgeRequest<{ spawner: { enabled: boolean } }>(
      "engine/state/snapshot",
      {},
    );
    expect(after.spawner.enabled, "expected the spawner to self-disable on refusal").toBe(false);
  } finally {
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("estimate-reset", () =>
      bridgeRequest("engine/set/estimated-load", { perInstance: 0 }),
    );
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});

test("a disabled guard bypasses the estimate gate (instance placed, no refusal)", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  // Guard DISABLED: the hard gate is OFF regardless of the estimate
  // (#123 "uncapped is an explicit power-user choice").
  await bridgeRequest("engine/set/overload-guard", { enabled: false, maxParticles: 1_000 });
  // A huge estimate that WOULD be refused if the guard were enabled.
  await bridgeRequest("engine/set/estimated-load", { perInstance: 5_000 });

  const snapshot = await bridgeRequest<{ spawner: unknown }>("engine/state/snapshot", {});
  const origSpawner = snapshot.spawner;

  try {
    await bridgeRequest("spawner/start", MANUAL_SPAWNER_1);

    // Watch for a refusal while triggering — none should fire.
    const refusalP = waitForRefusal(4_000);
    await bridgeRequest("spawner/trigger", {});
    const refusal = await refusalP;
    expect(refusal, "expected NO refusal while the guard is disabled").toBeNull();

    // The instance IS placed (gate bypassed).
    const instances = await readInstanceCount(5_000);
    expect(instances, "expected an instance to be placed with the guard disabled").toBeGreaterThanOrEqual(1);
  } finally {
    await cleanupStep("spawner-stop", () => bridgeRequest("spawner/stop", {}));
    if (origSpawner) {
      await cleanupStep("spawner-restore", () => bridgeRequest("spawner/start", origSpawner));
    }
    await cleanupStep("estimate-reset", () =>
      bridgeRequest("engine/set/estimated-load", { perInstance: 0 }),
    );
    await cleanupStep("engine-clear", () => bridgeRequest("engine/action/clear", {}));
    await cleanupStep("guard-restore", () =>
      bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 10_000 }),
    );
  }
});
