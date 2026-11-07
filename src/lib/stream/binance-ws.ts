"use client";

/**
 * One shared Binance market-data WebSocket for the whole app. Streams are
 * reference-counted and (re)subscribed with the SUBSCRIBE method, so any
 * number of components can listen without opening extra sockets.
 * Includes exponential-backoff reconnect and a heartbeat watchdog.
 */
export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting";
type Handler = (data: unknown) => void;

const WS_BASE = process.env.NEXT_PUBLIC_BINANCE_WS_URL || "wss://data-stream.binance.vision";
const HEARTBEAT_MS = 25_000;

class BinanceStream {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Handler>>();
  private statusListeners = new Set<() => void>();
  private _status: StreamStatus = "idle";
  private attempts = 0;
  private reqId = 1;
  private lastMessageAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingUnsub = new Set<string>();
  private unsubTimer: ReturnType<typeof setTimeout> | null = null;

  get status() { return this._status; }
  get lastMessage() { return this.lastMessageAt; }

  onStatus(fn: () => void) {
    this.statusListeners.add(fn);
    return () => { this.statusListeners.delete(fn); };
  }

  private setStatus(s: StreamStatus) {
    this._status = s;
    this.statusListeners.forEach((f) => f());
  }

  subscribe(stream: string, handler: Handler): () => void {
    // Symbol part must be lowercase; the stream type is case-sensitive (e.g. @miniTicker).
    const at = stream.indexOf("@");
    const key = at > 0 ? stream.slice(0, at).toLowerCase() + stream.slice(at) : stream;
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
      this.pendingUnsub.delete(key);
      this.send("SUBSCRIBE", [key]);
    }
    set.add(handler);
    this.ensure();
    return () => {
      const s = this.subs.get(key);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.subs.delete(key);
        // Batch unsubscribes — React often unmounts/remounts quickly.
        this.pendingUnsub.add(key);
        this.unsubTimer ??= setTimeout(() => this.flushUnsub(), 500);
      }
    };
  }

  private flushUnsub() {
    this.unsubTimer = null;
    const list = [...this.pendingUnsub].filter((k) => !this.subs.has(k));
    this.pendingUnsub.clear();
    if (list.length) this.send("UNSUBSCRIBE", list);
    if (this.subs.size === 0) this.close();
  }

  private send(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method, params, id: this.reqId++ }));
  }

  private ensure() {
    if (typeof window === "undefined" || this.ws || this.reconnectTimer) return;
    this.connect();
  }

  private connect() {
    this.setStatus(this.attempts ? "reconnecting" : "connecting");
    const ws = new WebSocket(`${WS_BASE}/stream`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.lastMessageAt = Date.now();
      this.setStatus("open");
      const all = [...this.subs.keys()];
      // Binance limits params per request; chunk to be safe.
      for (let i = 0; i < all.length; i += 100) this.send("SUBSCRIBE", all.slice(i, i + 100));
      this.watchdog ??= setInterval(() => {
        if (Date.now() - this.lastMessageAt > HEARTBEAT_MS && this.subs.size) this.ws?.close();
      }, 5000);
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg: { stream?: string; data?: unknown };
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      if (!msg.stream) return;
      this.subs.get(msg.stream)?.forEach((h) => h(msg.data));
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.subs.size === 0) { this.setStatus("idle"); return; }
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) + Math.random() * 500;
    this.attempts++;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subs.size) this.connect();
    }, delay);
  }

  private close() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    this.ws?.close();
    this.ws = null;
    this.setStatus("idle");
  }
}

let instance: BinanceStream | null = null;
export function binanceStream(): BinanceStream {
  return (instance ??= new BinanceStream());
}

/* ---- payload types for the streams we use ---- */
export interface WsKline { e: "kline"; s: string; k: { t: number; i: string; o: string; h: string; l: string; c: string; v: string; n: number; x: boolean; V: string } }
export interface WsAggTrade { e: "aggTrade"; s: string; a: number; p: string; q: string; T: number; m: boolean }
export interface WsMiniTicker { e: "24hrMiniTicker"; s: string; c: string; o: string; h: string; l: string; v: string; q: string; E: number }
export interface WsDepth { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }
