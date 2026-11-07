import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import type { TvlStats } from "../types";

export function getDefiTvl() {
  return cached("llama:tvl", "DefiLlama", { ttlMs: 10 * 60_000, staleMs: 6 * 3600_000 }, async (): Promise<TvlStats> => {
    const raw = await fetchUpstream<{ date: number; tvl: number }[]>("https://api.llama.fi/v2/historicalChainTvl", { timeoutMs: 12_000 });
    const last = raw.at(-1)?.tvl ?? 0;
    const prev = raw.at(-2)?.tvl ?? last;
    return { tvl: last, change24h: prev ? ((last - prev) / prev) * 100 : 0, series: raw.slice(-30).map((d) => d.tvl) };
  });
}
