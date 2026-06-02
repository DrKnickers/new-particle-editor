# G7 — transactional `AlphaCompositor::Resize`

`[lt-4]` `[P3 latent]`. Source: post-audit reconciliation block (`G7`). Branch:
`lt-4` (FF-push on land; **never `master` without explicit OK**).

## 1. Goal + scope

**Goal.** `AlphaCompositor::Resize` currently frees all old GPU/GDI resources
*before* allocating the new ones. If any allocation throws, the compositor is
left half-destroyed (old gone, new partial, `width/height` stale) → a dead
viewport until process restart. Make it transactional: build new resources into
locals, swap into `m_impl` only on full success, roll back (keep the old
resources) on any failure.

**In:** rewrite `AlphaCompositor::Resize` ([src/host/AlphaCompositor.cpp:114](src/host/AlphaCompositor.cpp:114)).

**Out (reasons):** `ReleaseGpuResources()` — its job *is* a full release before
device Reset; not a resize, leave it. Composite/readback path — untouched.
Fault-injection test harness — over-engineering for a P3 (the rollback is
correct-by-construction; no runtime trigger on a healthy box).

## 2. What the codebase already gives us

- Resource set in `Impl` ([:45](src/host/AlphaCompositor.cpp:45)): `sharedTex`
  (`ComPtr<IDirect3DTexture9>`), `sharedHandle` (HANDLE, **owned by sharedTex** —
  no CloseHandle), `offscreenRT` (`ComPtr`, = sharedTex level 0), `sysMemSurface`
  (`ComPtr`), `dibBitmap` (HBITMAP), `dibPixels` (void*), `memDC` (HDC), `width`,
  `height`.
- `ThrowIfFailed` ([:31](src/host/AlphaCompositor.cpp:31)) throws on bad HRESULT;
  the two GDI failures throw `std::runtime_error`. So the build sequence already
  signals failure by exception — the swap just needs to be exception-safe.
- Caller: `Engine` device-Reset path ([engine.cpp:1435](src/engine.cpp:1435)),
  non-null in **both** arch-B and arch-C (engine.cpp:985). Exercised by the a11y
  `viewport-resize.spec.ts` happy path under composition (the default lane).

## 3. Implementation approach

```
void Resize(w, h):
  if (w,h)==current return;  if degenerate return;   // unchanged guards
  // locals
  ComPtr newTex; HANDLE newHandle=nullptr; ComPtr newRT, newSys;
  HBITMAP newDib=nullptr; void* newPixels=nullptr; HDC newDC=nullptr;
  try {
    CreateTexture(... &newTex, &newHandle); ThrowIfFailed;
    newTex->GetSurfaceLevel(0,&newRT);      ThrowIfFailed;
    CreateOffscreenPlainSurface(... &newSys); ThrowIfFailed;
    newDib = CreateDIBSection(... &newPixels); if(!newDib||!newPixels) throw;
    newDC  = CreateCompatibleDC(nullptr);      if(!newDC) throw;
    SelectObject(newDC, newDib);
  } catch (...) {
    if (newDC)  DeleteDC(newDC);      // DC first so the DIB is deselected
    if (newDib) DeleteObject(newDib); // ComPtr locals auto-release on unwind
    throw;                            // m_impl UNTOUCHED → old size still live
  }
  // commit: release old, then move locals in
  offscreenRT.Reset(); sharedTex.Reset(); sharedHandle=nullptr; sysMemSurface.Reset();
  if (dibBitmap) DeleteObject; if (memDC) DeleteDC;
  sharedTex=move(newTex); sharedHandle=newHandle; offscreenRT=move(newRT);
  sysMemSurface=move(newSys); dibBitmap=newDib; dibPixels=newPixels; memDC=newDC;
  width=w; height=h;
  fprintf(stderr,"[AlphaCompositor] shared RT ...", newHandle);  // moved after swap
```

Key decisions: (a) GDI handles need manual cleanup in `catch` (no ComPtr); order
`DeleteDC` before `DeleteObject` so the DIB isn't deleted while selected. (b) the
debug `fprintf` moves below the swap so it logs only on a *committed* resize. (c)
no behavioural change on the happy path — same resources, same order of creation.

## 4. Risks + mitigations

1. **GDI leak on the failure path** — if `CreateCompatibleDC` throws after the
   DIB was made, the DIB must be freed. *Mitigation:* the `catch` frees both
   locals; ComPtrs auto-release. Verified by reading the unwind order.
2. **Deleting a selected DIB** — `DeleteObject(dib)` fails if the bitmap is still
   selected into a DC. *Mitigation:* `catch` does `DeleteDC(newDC)` first; commit
   path only deletes the *old* dib whose DC is also being deleted in the same block.
3. **Happy-path regression** — the rewrite must produce byte-identical resources.
   *Mitigation:* same Create* calls, same params, same SelectObject; a11y
   `viewport-resize` is the gate.

## 5. Testing & verification

- [ ] Debug + Release x64 clean (only the pre-existing LNK4098).
- [ ] a11y → **157 pass / 4 splitters** (L-033), unchanged — proves resize +
      device-Reset happy path still allocates a valid RT under composition.
- [ ] Static walk: catch frees newDC+newDib and rethrows; commit releases old
      before moving locals; `sharedHandle` never CloseHandle'd (owned by tex);
      `width/height` set only on commit; degenerate/unchanged guards intact.
- [ ] Couldn't verify autonomously: the actual rollback-on-alloc-failure path
      (no runtime trigger on a healthy box) — correct-by-construction.

## Review section

**What landed.** One function rewritten — `AlphaCompositor::Resize`
([src/host/AlphaCompositor.cpp:114](src/host/AlphaCompositor.cpp:114)) — destroy-
then-rebuild → build-locals-then-swap. ~40 LoC net. `ReleaseGpuResources()`
untouched.

**Verification (all run).**
- Debug + Release x64 clean.
- a11y: first run showed 156/**5** — the 5th was a transient L-033 agent-launch
  flake (the `viewport-resize` spec itself passed). Re-run → **157 pass / 4
  splitters**, baseline-identical. Lesson: don't accept/reject on one native run
  when the failure isn't in the deterministic splitter set (→ L-038 reinforced).
- Static walk: catch frees `newDC` then `newDib` and rethrows with `m_impl`
  untouched; commit releases old before moving locals in; `sharedHandle` never
  CloseHandle'd; `width/height` set only on commit.

**Couldn't verify autonomously.** The rollback-on-allocation-failure path has no
runtime trigger on a healthy box (the P3 rationale). Correct-by-construction: the
`try` only mutates locals, the `catch` cleans them and rethrows before any
`m_impl` write.
