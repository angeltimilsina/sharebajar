import type { ChainAdapter, PoolSummary } from "../../../packages/chain-adapters/src/index.ts";
import type { Db } from "./db.ts";

export type Feed = "new_pool" | "trending" | "top_volume";
export interface IngestResult { chain: string; pools: number; snapshots: number; newEvents: number; errors: string[] }

/** Snapshot time: truncated to the minute, so re-runs within a minute don't duplicate rows. */
export const snapshotTime = (now = Date.now()) => new Date(Math.floor(now / 60_000) * 60_000).toISOString();

/**
 * Writes one batch of pools: upserts tokens and pools, inserts one snapshot
 * per pool for this minute, and records listing events the first time a pool
 * appears in a feed. Values a provider didn't return are stored as NULL.
 */
export async function writeBatch(db: Db, feed: Feed, pools: PoolSummary[], now = Date.now()): Promise<{ snapshots: number; newEvents: number }> {
  const t = snapshotTime(now);
  let snapshots = 0, newEvents = 0;
  for (const [rank, p] of pools.entries()) {
    if (!p.address || !p.base.address) continue;
    await db.query(
      `insert into market_tokens (chain, address, symbol, name, image) values ($1,$2,$3,$4,$5)
       on conflict (chain, address) do update set symbol=excluded.symbol, name=excluded.name, image=coalesce(excluded.image, market_tokens.image), last_seen=now()`,
      [p.chain, p.base.address, p.base.symbol.slice(0, 64), p.base.name.slice(0, 200), p.base.image]);
    await db.query(
      `insert into market_pools (chain, address, dex, name, base_address, quote_address, quote_symbol, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (chain, address) do update set last_seen=now(), dex=excluded.dex, name=excluded.name`,
      [p.chain, p.address, p.dex.slice(0, 64), p.name.slice(0, 200), p.base.address, p.quote.address, p.quote.symbol.slice(0, 64), p.createdAt ? new Date(p.createdAt).toISOString() : null]);
    const r = await db.query(
      `insert into pool_snapshots (time, chain, address, price_usd, liquidity_usd, volume_24h_usd, fdv_usd, market_cap_usd, buys_24h, sells_24h, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (chain, address, time) do nothing returning 1`,
      [t, p.chain, p.address, p.priceUsd, p.liquidityUsd, p.volumeUsd.h24, p.fdvUsd, p.marketCapUsd, p.txns.h24?.buys ?? null, p.txns.h24?.sells ?? null, p.source]);
    snapshots += r.length;
    // A listing event the first time this pool shows up in this feed (newly listed, newly trending, newly top volume).
    const seen = await db.query("select 1 from market_events where chain=$1 and kind=$2 and address=$3 limit 1", [p.chain, feed, p.address]);
    if (!seen.length) { await db.query("insert into market_events (chain, kind, address, rank) values ($1,$2,$3,$4)", [p.chain, feed, p.address, rank + 1]); newEvents++; }
  }
  return { snapshots, newEvents };
}

/** One indexing pass for a chain: new pools, trending and top volume. Each feed fails independently. */
export async function indexChain(db: Db, adapter: ChainAdapter, now = Date.now()): Promise<IngestResult> {
  const out: IngestResult = { chain: adapter.chain.id, pools: 0, snapshots: 0, newEvents: 0, errors: [] };
  const feeds: [Feed, () => Promise<PoolSummary[]>][] = [["new_pool", () => adapter.newPools()], ["trending", () => adapter.trending()], ["top_volume", () => adapter.topPools()]];
  for (const [feed, load] of feeds) {
    try {
      const pools = await load();
      const r = await writeBatch(db, feed, pools, now);
      out.pools += pools.length; out.snapshots += r.snapshots; out.newEvents += r.newEvents;
    } catch (e) {
      out.errors.push(`${feed}: ${String((e as Error).message ?? e).slice(0, 160)}`);
    }
  }
  return out;
}
