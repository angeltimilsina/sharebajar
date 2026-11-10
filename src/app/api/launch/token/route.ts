import { NextResponse } from "next/server";
import { launchOf, profileOf, readMetadataJson, siblingsOf } from "@/lib/launch/profile";

const CHAINS = ["solana", "ethereum", "base", "bsc"];

/**
 * Everything the token manager shows: the launch record, its sibling networks,
 * profile and on-chain metadata. Each part is loaded independently, so a
 * database hiccup never hides the token (on-chain data still loads).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const chain = u.searchParams.get("chain") ?? "";
  const token = u.searchParams.get("token") ?? "";
  if (!CHAINS.includes(chain) || !(chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  const warnings: string[] = [];
  const launch = await launchOf(chain, token).catch((e) => { warnings.push(`records: ${String(e).slice(0, 100)}`); return null; });
  const [siblings, profile] = await Promise.all([
    siblingsOf(launch?.group_id ?? null).catch(() => []),
    profileOf(chain, token).catch(() => null),
  ]);
  let metadata: { name: string; symbol: string; uri: string; json: Awaited<ReturnType<typeof readMetadataJson>> } | null = null;
  if (chain === "solana") {
    try {
      const { tokenMetadata } = await import("@/lib/launch/metadata");
      const md = await tokenMetadata(token);
      if (md) metadata = { ...md, json: md.uri ? await readMetadataJson(md.uri).catch(() => null) : null };
    } catch (e) { warnings.push(`metadata: ${String(e).slice(0, 100)}`); }
  }
  return NextResponse.json({ launch, siblings, profile, metadata, warnings }, { headers: { "cache-control": "no-store" } });
}
