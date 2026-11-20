import "server-only";
import { z } from "zod";
import { q } from "@/lib/treasury/db";

const httpsUrl = z.string().trim().max(300).refine((u) => /^https:\/\/[^\s]+$/.test(u), "Links must start with https://");
export const ProfileFields = z.object({
  image: httpsUrl.optional().or(z.literal("")),
  description: z.string().max(600).optional(),
  website: httpsUrl.optional().or(z.literal("")),
  twitter: httpsUrl.optional().or(z.literal("")),
  telegram: httpsUrl.optional().or(z.literal("")),
  discord: httpsUrl.optional().or(z.literal("")),
});
export type ProfileFields = z.infer<typeof ProfileFields>;

export interface LaunchRow { mint: string; chain: string; name: string; symbol: string; creator: string; signature: string; metadata_uri: string | null; fixed_supply: boolean; freeze_revoked: boolean; supply: string; decimals: number; group_id: string | null; created_at: string }

export async function launchOf(chain: string, token: string): Promise<LaunchRow | null> {
  const rows = await q<LaunchRow>("select * from token_launches where chain = $1 and lower(mint) = lower($2) limit 1", [chain, token]);
  return rows[0] ?? null;
}

export async function siblingsOf(groupId: string | null): Promise<Pick<LaunchRow, "mint" | "chain" | "symbol" | "name">[]> {
  if (!groupId) return [];
  return q("select mint, chain, symbol, name from token_launches where group_id = $1 order by created_at", [groupId]);
}

export async function profileOf(chain: string, token: string) {
  const r = await q<ProfileFields & { updated_at: string; updated_by: string }>("select image, description, website, twitter, telegram, discord, updated_at, updated_by from token_profiles where chain = $1 and lower(token) = lower($2)", [chain, token]);
  return r[0] ?? null;
}

export async function saveProfile(chain: string, token: string, f: ProfileFields, by: string) {
  const v = (x?: string) => (x && x.trim() ? x.trim() : null);
  await q(
    `insert into token_profiles (chain, token, image, description, website, twitter, telegram, discord, updated_by, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     on conflict (chain, token) do update set image = excluded.image, description = excluded.description, website = excluded.website,
       twitter = excluded.twitter, telegram = excluded.telegram, discord = excluded.discord, updated_by = excluded.updated_by, updated_at = now()`,
    [chain, token, v(f.image), v(f.description), v(f.website), v(f.twitter), v(f.telegram), v(f.discord), by],
  );
}

/** Read Metaplex-style JSON metadata for display (https/ipfs/ar only, small, no private hosts). */
export async function readMetadataJson(uri: string): Promise<{ image?: string; description?: string; website?: string; twitter?: string; telegram?: string } | null> {
  let url = uri.trim();
  if (url.startsWith("ipfs://")) url = `https://ipfs.io/ipfs/${url.slice(7)}`;
  else if (url.startsWith("ar://")) url = `https://arweave.net/${url.slice(5)}`;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[)/.test(u.hostname) || u.hostname.endsWith(".internal") || u.hostname.endsWith(".local")) return null;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(6000), redirect: "error" });
    if (!r.ok) return null;
    const text = (await r.text()).slice(0, 20_000);
    const j = JSON.parse(text) as { image?: unknown; description?: unknown; extensions?: Record<string, unknown> };
    const s = (x: unknown) => (typeof x === "string" && x.length < 600 ? x : undefined);
    return { image: s(j.image), description: s(j.description), website: s(j.extensions?.website), twitter: s(j.extensions?.twitter), telegram: s(j.extensions?.telegram) };
  } catch { return null; }
}
