// separator-drag.ts — module-level state for "splitter drag in flight".
//
// Why this exists. The engine viewport is a top-level layered Win32
// popup composited above WebView2 (FD9b). LayoutBroker::Apply moves
// the popup via SetWindowPos AND triggers an expensive D3D9
// Engine::Reset per non-degenerate size change. During a fast
// splitter drag, ViewportSlot's ResizeObserver fires per layout
// change, each call stacks a Reset, and the popup falls far behind
// the WebView's flex-layout — symptom: the popup paints over the
// neighbouring pane during the drag and snaps back on release.
//
// Fix. Track "we're inside a splitter drag" at module scope so
// ViewportSlot can short-circuit its per-frame send while the flag
// is true. PanelLayout flips the flag via document-level
// pointerdown/pointerup capture listeners; on pointerdown it also
// dispatches `layout/viewport-rect {w:0,h:0}` at (-32768,-32768)
// which routes to LayoutBroker's degenerate-size early-out
// (SetWindowPos to 1×1 offscreen, NO Engine::Reset). The popup is
// effectively hidden for the duration of the drag.
//
// On drag-end, ViewportSlot's subscription fires send() once, which
// reads the final quadrant-viewport rect and re-positions the popup
// at the new layout. ONE Reset, not N.
//
// Cross-reference. L-013 in tasks/lessons.md ("the Win32 drag-resize
// modal sizing loop starves WebView2 IPC") — same class of problem,
// same solution shape (encode the durable state instead of chasing
// per-frame messages). The B1.3.1.1 frosted-glass modal also took
// this approach (one-shot snapshot on modal open rather than rAF
// re-capture during the modal sizing loop).

type Listener = (dragging: boolean) => void;

let dragging = false;
const listeners = new Set<Listener>();

export function isSeparatorDragging(): boolean {
  return dragging;
}

export function setSeparatorDragging(next: boolean): void {
  if (dragging === next) return;
  dragging = next;
  for (const cb of listeners) cb(dragging);
}

/** Subscribe to drag-state transitions. Returns an unsubscribe fn. */
export function subscribeSeparatorDragging(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test-only: reset module state between vitest cases. */
export function __resetSeparatorDraggingForTests(): void {
  dragging = false;
  listeners.clear();
}
