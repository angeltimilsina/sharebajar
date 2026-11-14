import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePools, createAdapter, chainById, type FetchJson } from "@bajar/chain-adapters";
import { migrate, openDb } from "../src/db.ts";
import { indexChain, snapshotTime, writeBatch } from "../src/ingest.ts";

const fx = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../packages/chain-adapters/test/fixtures", `${n}.json`), "utf8"));

describe("indexer", () => {
  it("migrates once, then writes pools, tokens, snapshots and listing events idempotently", async () => {
    const db = await openDb({ INDEXER_PGLITE_DIR: "memory://" } as unknown as NodeJS.ProcessEnv);
    expect(await migrate(db)).toEqual(["001_market.sql"]);
    expect(await migrate(db)).toEqual([]); // already applied

    const pools = parsePools(fx("gt-new-solana"));
    const t0 = Date.parse("2026-11-14T10:00:30Z");
    const a = await writeBatch(db, "new_pool", pools, t0);
    expect(a.snapshots).toBe(pools.length);
    expect(a.newEvents).toBe(pools.length);

    // Same minute again: no duplicate snapshots or events.
    const b = await writeBatch(db, "new_pool", pools, t0 + 10_000);
    expect(b).toEqual({ snapshots: 0, newEvents: 0 });

    // Next minute: a new snapshot per pool (the time series), still no new events.
    const c = await writeBatch(db, "new_pool", pools, t0 + 60_000);
    expect(c).toEqual({ snapshots: pools.length, newEvents: 0 });

    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from pool_snapshots where address=$1", [pools[0].address]);
    expect(n).toBe(2);
    const [pool] = await db.query<{ base_address: string }>("select base_address from market_pools where chain='solana' and address=$1", [pools[0].address]);
    expect(pool.base_address).toBe(pools[0].base.address);
    expect((await db.query("select 1 from market_tokens")).length).toBeGreaterThan(0);
    expect(snapshotTime(t0)).toBe("2026-11-14T10:00:00.000Z");
    await db.close();
  });

  it("a failing feed doesn't stop the others", async () => {
    const db = await openDb({ INDEXER_PGLITE_DIR: "memory://" } as unknown as NodeJS.ProcessEnv);
    await migrate(db);
    const fetchJson: FetchJson = async <T,>(url: string) => {
      if (url.includes("trending_pools")) throw new Error("429 rate limited");
      return (url.includes("new_pools") ? fx("gt-new-base") : fx("gt-trending-base")) as T;
    };
    const r = await indexChain(db, createAdapter(chainById("base")!, { fetchJson }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^trending: /);
    expect(r.pools).toBeGreaterThan(0);
    await db.close();
  });
});
