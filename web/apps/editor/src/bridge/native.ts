import type { Bridge, Request, ResponseFor, Event, EventKind, EventOf, WireMessage, RequestId } from "@particle-editor/bridge-schema";

type Pending = { resolve: (data: unknown) => void; reject: (err: Error) => void };

declare global {
  interface Window {
    chrome?: { webview?: { postMessage: (s: string) => void; addEventListener: (ev: string, h: (e: { data: string }) => void) => void } };
  }
}

export class NativeBridge implements Bridge {
  private pending = new Map<RequestId, Pending>();
  private listeners = new Map<EventKind, Set<(e: Event) => void>>();
  private idCounter = 0;

  constructor() {
    const wv = window.chrome?.webview;
    if (!wv) {
      throw new Error("NativeBridge: chrome.webview unavailable — running in browser? Use MockBridge.");
    }
    wv.addEventListener("message", (e) => this.onMessage(e.data));
  }

  private nextId(): RequestId {
    this.idCounter += 1;
    return `r${this.idCounter}-${Date.now().toString(36)}`;
  }

  request<R extends Request>(req: R): Promise<ResponseFor<R>> {
    const id = this.nextId();
    const envelope: WireMessage = { type: "req", id, kind: req.kind, params: req.params } as WireMessage;
    return new Promise<ResponseFor<R>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject });
      window.chrome!.webview!.postMessage(JSON.stringify(envelope));
    });
  }

  on<K extends EventKind>(kind: K, handler: (e: EventOf<K>) => void): () => void {
    let bucket = this.listeners.get(kind);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(kind, bucket);
    }
    bucket.add(handler as (e: Event) => void);
    return () => { bucket?.delete(handler as (e: Event) => void); };
  }

  private onMessage(raw: string): void {
    let msg: WireMessage;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "res") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error));
    } else if (msg.type === "evt") {
      const bucket = this.listeners.get(msg.kind);
      bucket?.forEach((h) => h({ kind: msg.kind, payload: msg.payload } as Event));
    }
  }
}
