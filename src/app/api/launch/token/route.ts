import { NextResponse } from "next/server";
import { launchOf, profileOf, readMetadataJson, siblingsOf } from "@/lib/launch/profile";

const CHAINS = ["solana", "ethereum", "base", "bsc"];

/** Everything the token manager shows: the launch record, its sibling networks, profile and on-chain metadata. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const chain = u.searchParams.get("chain") ?? "";
  const token = u.searchParams.get("token") ?? "";
  if (!CHAINS.includes(chain) || !(chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  try {
    const launch = await launchOf(chain, token);
    const [siblings, profile] = await Promise.all([siblingsOf(launch?.group_id ?? null), profileOf(chain, token)]);
    let metadata: { name: string; symbol: string; uri: string; json: Awaited<ReturnType<typeof readMetadataJson>> } | null = null;
    if (chain === "solana") {
      const { tokenMetadata } = await import("@/lib/launch/metadata");
      const md = await tokenMetadata(token).catch(() => null);
      if (md) metadata = { ...md, json: md.uri ? await readMetadataJson(md.uri) : null };
    }
    return NextResponse.json({ launch, siblings, profile, metadata }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "Token data unavailable right now.", detail: String(e).slice(0, 120) }, { status: 503 });
  }
}
