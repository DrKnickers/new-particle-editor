# NT-10 — Further reduce maximized save-modal backdrop snapshot latency

Session 29. Branch `claude/brave-bouman-f44073` off `master` (`900b317`+,
lineage clean: `HEAD..origin/master` = 0). ROADMAP §1.3 [NT-10].

Pre-flight baseline (this worktree, all green):
- web **537/537**, `tsc -b` + `vite build` clean (dist produced)
- host **Debug x64** clean (LNK4098 is the known-benign warning)
- native harness **174 passed / 30 skipped**
- fresh-worktree restore done: L-039 (WebView2 1.0.3967.48 → `packages/`),
  pnpm install, L-040 (`pnpm build`).

---

## 1. Goal + scope

**Goal.** Cut the maximized (3440×1369) modal-backdrop snapshot latency from
~69 ms toward the windowed ~18 ms, by moving the downscale onto the GPU
(`StretchRect`) so the readback, the ~19 MB memcpy, and the GDI+ `DrawImage`
all operate on the already-small (~1024×383) image instead of full RT size.
The frosted backdrop is blurred under `backdrop-blur-sm`, so effective
resolution (and thus visual quality) must stay **identical** to today's
downscale output dims.

**In:**
- `AlphaCompositor::CaptureSnapshotPng` only (`src/host/AlphaCompositor.cpp`).
- A GPU fast path: `StretchRect` the scene-rect crop of `offscreenRT` into a
  small render target sized to today's `dstW×dstH`, read **that** back, encode.
- Runtime guards (caps query + HRESULT checks) + a fallback to the existing
  full-readback path, so there is **zero regression** on any device/driver.
- Debug instrumentation to prove which path ran and the latency.

**Out (with reasons):**
- `CaptureSnapshotToFile` (the `--capture` offline-diff path) — must stay
  full-res; it's a deliberately separate method (`AlphaCompositor.cpp:791`,
  comment at :795). Untouched.
- Avenue (b) async/double-buffered encode and (c) warm throttled cache — the
  ROADMAP calls (a) the most direct win; (b)/(c) stay as ROADMAP follow-ups if
  (a) proves insufficient.
- Changing the downscale **formula** or output dims — kept byte-identical so
  the native dim tests and the blur "floor" are unchanged.
- The per-frame `Composite()` / arch-C frame path — orthogonal.

---

## 2. What the codebase already gives us

- **Device**: D3D9Ex HAL — `Direct3DCreate9Ex` + `CreateDeviceEx(...,
  D3DDEVTYPE_HAL,...)` (`src/engine.cpp:2217,2259`). WDDM, so the relaxed
  StretchRect rules apply.
- **`offscreenRT`** = `sharedTex` level-0 surface, from
  `CreateTexture(w,h,1,D3DUSAGE_RENDERTARGET,D3DFMT_A8R8G8B8,D3DPOOL_DEFAULT,…)`
  (`AlphaCompositor.cpp:149-155`). A render-target **texture** surface, ARGB,
  POOL_DEFAULT, MULTISAMPLE_NONE.
- **`sysMemSurface`** = `CreateOffscreenPlainSurface(w,h,ARGB,SYSTEMMEM,…)`
  (`:159-163`) — the readback target.
- **Existing crop + downscale** (`CaptureSnapshotPng`, `:644-730`): crop to
  scene rect, `kSnapshotDownscale=2`, `kSnapshotMaxEdge=1024`, GDI+
  `InterpolationModeBilinear` `DrawImage`. The crop only needs `width/height`
  (available pre-readback), so it can move ahead of the GPU work.
- **Encode tail** (`:732-786`): `CreateStreamOnHGlobal` → `Bitmap::Save(PNG)` →
  `Base64Encode` → `outBase64/outW/outH` + the `[INSTANT-MODAL]` /
  `[CACHE-DEFERRAL-PERF]` debug logs. Shared between both paths.
- **Consumer contract**: `viewport/capture-snapshot`
  (`BridgeDispatcher.cpp:1047`) → on `false` sends `{pngBase64:"",w:0,h:0}` and
  React skips the `<img>` (modal opens with **no** frosted backdrop —
  graceful, but a visible downgrade → motivates the fallback).
- **Native dim tests** (`alpha-compositor-snapshot.spec.ts`): assert exact dims
  1024×768→512×384, 800×600→400×300, 1600×900→800×450, plus the `iVBORw0KGgo`
  PNG signature. Run on the **real** HAL device → end-to-end-validate the path.
- **Engine RT binding** (`engine.cpp:674/943/984/1017`): `offscreenRT` is the
  bound slot-0 RT at snapshot time; the engine re-binds it every frame at :674;
  snapshot runs **outside** BeginScene/EndScene (EndScene at :984).

---

## 3. Architecture / implementation approach

Refactor `CaptureSnapshotPng` into: **compute crop + dims (shared)** →
**fast path (GPU StretchRect)** → on failure **slow path (existing full
readback)** → **shared encode tail**.

### 3.1 Caps (queried once, cached on `Impl`)
At first snapshot (or in `Resize`), `device->GetDeviceCaps(&caps)` and record:
- `canStretchFromTex = caps.DevCaps2 & D3DDEVCAPS2_CAN_STRETCHRECT_FROM_TEXTURES`
  — required because `offscreenRT` is an RT **texture** surface, not a plain RT.
- `linearFilter = (caps.StretchRectFilterCaps & D3DPTFILTERCAPS_MINFLINEAR)`
  → choose `D3DTEXF_LINEAR` if present, else `D3DTEXF_POINT`.

### 3.2 Fast path
```
compute cropX/Y/W/H (from sceneRect, clamped to width/height)   // pre-readback
compute dstW/dstH                       // EXISTING formula, reused verbatim
if (!canStretchFromTex || dstW==cropW)  // no cap, or no downscale → slow path
guard: save slot-0 RT; bind a neutral surface (back buffer) so offscreenRT is
       NOT the active source during the blit; RAII-restore on every exit.
CreateRenderTarget(dstW,dstH,ARGB,MULTISAMPLE_NONE,0,FALSE,&smallRT,nullptr)
CreateOffscreenPlainSurface(dstW,dstH,ARGB,SYSTEMMEM,&smallSys,nullptr)
StretchRect(offscreenRT, &srcRECT{crop}, smallRT, &dstRECT{0,0,dstW,dstH}, filter)
GetRenderTargetData(smallRT, smallSys); LockRect → memcpy dstW*dstH*4 → Unlock
wrap small buffer in a GDI+ Bitmap(dstW,dstH,…,ARGB) → encodeBmp
```
Any failure (Create*, StretchRect, GetRenderTargetData, LockRect) → return into
the slow path. The RAII guard restores slot-0 to `offscreenRT` regardless.

### 3.3 Active-RT mitigation — resolve empirically, keep the guard
`offscreenRT` is the bound RT at snapshot time (confirmed). MS WDDM docs say the
active-RT-source restriction is relaxed on D3D9Ex ("only remaining restriction
is RT usage"); the red-team says retail drivers *can* still reject it. The guard
(park slot-0 on the back buffer around the blit) is **correct on every runtime
and cheap (~3 lines + RAII)**, so it's included unconditionally. The debug log
will confirm whether StretchRect-from-active-RT would have worked here, but we
don't rely on it. Back buffer is full-size (≥ smallRT) and never presented in
arch-C, so parking the binding there is side-effect-free; depth-stencil
(`m_pDepthStencilSurface`, full size) is left bound and is ≥ smallRT so
`SetRenderTarget` accepts it.

### 3.4 Slow path (fallback) + encode tail
The existing full `GetRenderTargetData(offscreenRT→sysMemSurface)` + memcpy +
crop-view + `DrawImage` downscale, kept verbatim as the fallback. Both paths
converge on one encode tail (factored to a local lambda to avoid duplicating
stream/Save/base64/log + srcBmp lifetime juggling).

### 3.5 Debug instrumentation
- `[INSTANT-MODAL]` total (kept), plus a `path=fast|slow` + `stretchHr=0x…`
  field so a single stderr line tells us which path ran and why.
- `[CACHE-DEFERRAL-PERF]` readback time now reflects the small surface.

---

## 4. Risks named up front + mitigations

1. **StretchRect from the active RT may return `D3DERR_INVALIDCALL`** (the
   make-or-break, confirmed `offscreenRT` is bound). *Mitigation:* park slot-0
   on the back buffer around the blit (RAII restore on all exits) — makes the
   active-source question moot on all runtimes; debug log records the truth.
2. **Source is an RT *texture*** → needs `D3DDEVCAPS2_CAN_STRETCHRECT_FROM_TEXTURES`.
   *Mitigation:* cap-gate; absent → slow path.
3. **`D3DTEXF_LINEAR` needs `StretchRectFilterCaps` MINFLINEAR.** *Mitigation:*
   cap-gate; absent → `D3DTEXF_POINT` (still fine under blur).
4. **Any new failure mode silently dropping the backdrop** (`false`→no blur).
   *Mitigation:* full fallback to the proven slow path on every failure ⇒ zero
   regression; the only observable change on a "bad" device is no speed-up.
5. **Device-state corruption from the RT swap** breaking the next engine frame.
   *Mitigation:* touch only slot-0 (not depth); restore via RAII on every exit;
   the engine also re-binds at `engine.cpp:674` each frame (belt-and-suspenders).
6. **Dim drift breaking the native tests.** *Mitigation:* reuse the exact
   `dstW/dstH` formula; the small RT and StretchRect dst RECT use those ints.
7. **Bilinear softness vs. GDI+ bilinear.** Equivalent (both 2-tap), capped at
   2× min downscale, and blurred. *Mitigation:* user A/B at 3440×1369 (L-033);
   two-step GPU halving only if the single pass looks too soft (unlikely).

---

## 5. Testing & verification

**Build**: host Debug x64 clean (VS18, L-046). `pnpm build` (L-068/L-070).

**Native harness** (`test:native`): still **174/0**; the 3 snapshot-dim cases
prove the fast path produces 512×384 / 400×300 / 800×450 valid PNGs end-to-end
on the real HAL.

**Latency (objective, mine)** — `[INSTANT-MODAL]` via `Start-Process
-RedirectStandardError`: drive a **3440×1369** viewport-rect + scene-rect +
`viewport/capture-snapshot` over CDP; record before/after total ms and the
`path=` field. Target: maximized total well under the old ~69 ms.

**Edge cases:** no scene rect (full-RT crop); tiny viewport (no-downscale →
slow path); two consecutive snapshots (re-entrant, surfaces released each
call); a resize between snapshots (dims follow). Walk each mentally + the
harness covers the first three.

**Fallback proof:** temporarily force `canStretchFromTex=false` in a debug
build, confirm slow path still yields 174/0 and identical dims.

**Feel (user, L-033):** open the save-changes modal maximized in the real host;
confirm it appears instantly. Agent screenshots can't judge arch-C feel.

**Cleanup:** remove any temporary probe instrumentation before sign-off; keep
the `path=`/`stretchHr=` field only if it's `#ifndef NDEBUG`.

---

## 6. Review

**Shipped: avenue (a) GPU `StretchRect` fast path + JPEG backdrop.** The plan
assumed avenue (a) was the win; profiling proved otherwise and the scope grew
(with user sign-off) to add JPEG. Final maximized `[INSTANT-MODAL]`:
**~72 ms → ~6 ms (~11×)**, payload **905 KB → ~120 KB**.

**What was built (all in `CaptureSnapshotPng`, the slow path kept as fallback):**
- Shared crop + dims computation moved ahead of any readback.
- `tryStretchPath`: caps-gated (`CAN_STRETCHRECT_FROM_TEXTURES` + `MINFLINEAR`)
  GPU `StretchRect` of the scene-rect crop → small `CreateRenderTarget`, with
  slot-0 parked on the back buffer around the blit (active-RT-source guard),
  then a small `GetRenderTargetData` readback. Falls through to the slow path on
  any miss.
- `encodeBitmap` lambda shared by both paths; encodes **JPEG q82** (was PNG).
- Field rename `pngBase64` → `imageBase64` (host + bridge-schema + Modal + mock +
  test); `CaptureSnapshotToFile` left full-res PNG.

**Verification (all green):** host Debug x64 clean; web vitest **537/537**;
`tsc -b` + `vite build` clean; native harness **174/0** (fast path) AND **174/0**
with `NT10_FORCE_SLOW=1` (fallback proof); same-machine `[INSTANT-MODAL]` A/B
captured (slow ~72 ms / (a)-only ~53 ms / JPEG-slow ~30 ms / (a)+JPEG ~6 ms);
`path=fast stretchHr=0x0` confirmed on the real D3D9Ex HAL. Temp instrumentation
(`NT10_FORCE_SLOW`, `[NT10-SPLIT]`) + the throwaway probe removed before handoff.

**Risks that bit / didn't:** Risk #1 (active-RT `StretchRect`) was real in
principle — verified `offscreenRT` is the bound RT (`engine.cpp:674/943`) and
parked slot 0; on this HAL the blit returned `S_OK` regardless, but the guard is
correct on all runtimes. The unplanned find: the **encode**, not the readback,
dominated — captured as **L-073** (profile before trusting a triage avenue).

**Left for the user:** the maximized modal *feel* in the real host (L-033 — agent
runs can't judge arch-C timing), and backfilling the CHANGELOG/ROADMAP `#TODO`
merge hash + PR number after merge.
