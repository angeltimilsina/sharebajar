import { NextResponse } from "next/server";
import type { PoolSummary, Trade } from "@bajar/chain-adapters";
import { isAddress, chainById } from "@bajar/chain-adapters";
import { adapterFor } from "@/lib/api/v1";
import { cached } from "@/lib/server/cache";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export const maxDuration = 60;

/**
 * Live pool updates over Server-Sent Events: `pool` (price, liquidity,
 * volume) and `trade` (new swaps, oldest first). Every subscriber reads the
 * same short-lived cache, so the upstream is polled once per interval no
 * matter how many viewers. A stream lasts ~55 s; EventSource reconnects on its own.
 */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  const c = chainById(chain);
  if (!c || !isAddress(c, address)) return NextResponse.json({ error: { code: "invalid_params", message: "Unknown chain or invalid pool address." } }, { status: 400 });
  const rl = rateLimit(`v1s:${clientIp(req)}`, 20, 20);
  if (!rl.ok) return NextResponse.json({ error: { code: "rate_limited", message: "Too many streams." } }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const a = adapterFor(chain);
  const enc = new TextEncoder();
  const seen = new Set<string>();
  let lastPool = "";
  let alive = true;
  req.signal.addEventListener("abort", () => { alive = false; });

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => { if (alive) ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      ctrl.enqueue(enc.encode("retry: 3000\n\n"));
      const until = Date.now() + 55_000;
      let first = true;
      while (alive && Date.now() < until) {
        const [pool, trades] = await Promise.allSettled([
          cached(`v1:pool:${chain}:${address}`, "", { ttlMs: 5_000, staleMs: 60_000 }, () => a.pool(address)),
          cached(`v1:trades:${chain}:${address}`, "", { ttlMs: 5_000, staleMs: 60_000 }, () => a.trades(address)),
        ]);
        if (pool.status === "fulfilled" && pool.value.data) {
          const p = pool.value.data as PoolSummary;
          const sig = `${p.priceUsd}|${p.liquidityUsd}|${p.volumeUsd.h24}`;
          if (sig !== lastPool) { lastPool = sig; send("pool", { ...p, stale: pool.value.stale, fetchedAt: pool.value.fetchedAt }); }
        }
        if (trades.status === "fulfilled") {
          const fresh = (trades.value.data as Trade[]).filter((t) => !seen.has(t.txHash)).sort((x, y) => x.time - y.time);
          for (const t of fresh) seen.add(t.txHash);
          // On connect, send only the latest few; afterwards every new swap.
          const out = first ? fresh.slice(-20) : fresh;
          if (out.length) send("trades", out);
        }
        if (pool.status === "rejected" && trades.status === "rejected") send("unavailable", { message: "Market data is temporarily unavailable; retrying." });
        first = false;
        await new Promise((r) => setTimeout(r, 5_000));
      }
      if (alive) ctrl.close();
    },
    cancel() { alive = false; },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "access-control-allow-origin": "*" } });
}
