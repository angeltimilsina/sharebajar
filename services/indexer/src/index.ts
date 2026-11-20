import { createAdapters, type FetchJson } from "../../../packages/chain-adapters/src/index.ts";
import { migrate, openDb } from "./db.ts";
import { indexChain } from "./ingest.ts";

/**
 * BAJAR indexer: polls each chain's new, trending and top-volume pools and
 * writes pools, tokens, listing events and per-minute snapshots to Postgres
 * (TimescaleDB when available). Publishes a `bajar_market` NOTIFY after each
 * pass so API instances can push updates to WebSocket/SSE clients.
 *
 *   node services/indexer/src/index.ts            # run forever
 *   node services/indexer/src/index.ts --once     # one pass (cron / CI)
 *   node services/indexer/src/index.ts --migrate  # migrations only
 *
 * Env: DATABASE_URL, INDEXER_CHAINS (default solana,base), INDEXER_INTERVAL_SEC (default 60),
 *      COINGECKO_API_KEY (optional, higher GeckoTerminal limits).
 */

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, svc: "indexer", msg, ...extra }));

/** Paced fetch: one GeckoTerminal call per ~2.2 s (free tier), backs off on 429. */
export function pacedFetch(spacingMs = Number(process.env.INDEXER_SPACING_MS ?? 2200)): FetchJson {
  let next = 0;
  return async <T,>(url: string, init?: { headers?: Record<string, string> }): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const wait = next - Date.now();
      next = Math.max(Date.now(), next) + spacingMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "bajar-indexer/0.1 (+https://sharebajar.com)", ...init?.headers }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 && attempt < 4) {
        const ra = Number(res.headers.get("retry-after"));
        const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 15_000 * (attempt + 1);
        log("warn", "rate limited", { host: new URL(url).host, waitMs: ms });
        next = Date.now() + ms;
        continue;
      }
      if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
      return (await res.json()) as T;
    }
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const db = await openDb();
  const applied = await migrate(db);
  log("info", "migrations", { applied, db: db.kind });
  if (args.has("--migrate")) { await db.close(); return; }

  const chains = (process.env.INDEXER_CHAINS ?? "solana,base").split(",").map((s) => s.trim()).filter(Boolean);
  const adapters = createAdapters({ fetchJson: pacedFetch(), geckoTerminal: { apiKey: process.env.COINGECKO_API_KEY } }, chains);
  if (!adapters.size) throw new Error(`No supported chains in INDEXER_CHAINS=${process.env.INDEXER_CHAINS}`);
  const interval = Math.max(15, Number(process.env.INDEXER_INTERVAL_SEC ?? 60)) * 1000;
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; log("info", "stopping", { sig }); });

  do {
    const started = Date.now();
    for (const a of adapters.values()) {
      if (stopping) break;
      const r = await indexChain(db, a);
      log(r.errors.length ? "warn" : "info", "indexed", { ...r, ms: Date.now() - started });
      await db.notify("bajar_market", JSON.stringify({ chain: r.chain, pools: r.pools, newEvents: r.newEvents, at: Date.now() })).catch(() => {});
    }
    if (args.has("--once")) break;
    const rest = interval - (Date.now() - started);
    for (let t = 0; t < rest && !stopping; t += 500) await new Promise((r) => setTimeout(r, 500));
  } while (!stopping);
  await db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { log("error", "fatal", { error: String(e?.stack ?? e) }); process.exit(1); });
}
