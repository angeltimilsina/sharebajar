import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(stream: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ stream, data }) }); }
}

describe("Binance stream manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("window", {});
    vi.resetModules();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("multiplexes subscriptions, keeps stream-type case, and routes messages", async () => {
    const { binanceStream } = await import("@/lib/stream/binance-ws");
    const s = binanceStream();
    const a = vi.fn(), b = vi.fn();
    s.subscribe("BTCUSDT@miniTicker", a);
    s.subscribe("btcusdt@miniTicker", b);
    expect(FakeWS.instances).toHaveLength(1);
    const ws = FakeWS.instances[0];
    ws.open();
    expect(JSON.parse(ws.sent[0])).toMatchObject({ method: "SUBSCRIBE", params: ["btcusdt@miniTicker"] });
    ws.emit("btcusdt@miniTicker", { c: "1" });
    expect(a).toHaveBeenCalledWith({ c: "1" });
    expect(b).toHaveBeenCalledTimes(1);
    expect(s.status).toBe("open");
  });

  it("reconnects with backoff and resubscribes after a drop", async () => {
    const { binanceStream } = await import("@/lib/stream/binance-ws");
    const s = binanceStream();
    s.subscribe("ethusdt@kline_1s", () => {});
    FakeWS.instances[0].open();
    FakeWS.instances[0].close(); // network drop
    expect(s.status).toBe("reconnecting");
    vi.advanceTimersByTime(1600);
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1].open();
    expect(JSON.parse(FakeWS.instances[1].sent[0]).params).toEqual(["ethusdt@kline_1s"]);
    expect(s.status).toBe("open");
  });

  it("closes the socket when the heartbeat goes silent", async () => {
    const { binanceStream } = await import("@/lib/stream/binance-ws");
    const s = binanceStream();
    s.subscribe("solusdt@aggTrade", () => {});
    FakeWS.instances[0].open();
    vi.advanceTimersByTime(31_000);
    expect(s.status).toBe("reconnecting");
  });

  it("unsubscribes (batched) when the last listener leaves", async () => {
    const { binanceStream } = await import("@/lib/stream/binance-ws");
    const s = binanceStream();
    const off1 = s.subscribe("bnbusdt@miniTicker", () => {});
    const off2 = s.subscribe("xrpusdt@miniTicker", () => {});
    const ws = FakeWS.instances[0];
    ws.open();
    off1();
    vi.advanceTimersByTime(600);
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ method: "UNSUBSCRIBE", params: ["bnbusdt@miniTicker"] });
    off2();
    vi.advanceTimersByTime(600);
    expect(s.status).toBe("idle");
  });
});
