import type { Bridge, Request, ResponseFor, EventKind, EventOf } from "@particle-editor/bridge-schema";

// Minimal MockBridge — every request rejects until Task 2.1 fleshes it out.
// Event subscriptions are accepted but no events are ever fired.
// This is intentional: the skeleton exists so screen code can import a
// Bridge instance; concrete behaviour lands per-screen in Phase 3.
export class MockBridge implements Bridge {
  async request<R extends Request>(req: R): Promise<ResponseFor<R>> {
    throw new Error(`MockBridge: '${req.kind}' not implemented yet (filled in Task 2.1+)`);
  }

  on<K extends EventKind>(_kind: K, _handler: (e: EventOf<K>) => void): () => void {
    // No-op subscriber. Returns a noop unsubscribe.
    return () => {};
  }
}
