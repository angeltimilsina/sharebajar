import { NextResponse } from "next/server";
import { z } from "zod";
import { q } from "@/lib/treasury/db";
import { srpc } from "@/lib/treasury/solana";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const B58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,90}$/);
const Body = z.object({ signature: B58, mint: B58 });

interface MintParsed { value: { owner: string; data: { parsed: { type: string; info: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } | null }

/**
 * Records a token launched through Bajar for the Launchpad feed — but only
 * after verifying on-chain that the transaction succeeded and created this
 * mint (nothing is trusted from the browser).
 */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`launchrec:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { signature, mint } = p.data;
  try {
    const tx = await srpc<{ meta: { err: unknown } | null; transaction: { message: { accountKeys: ({ pubkey: string; signer: boolean } | string)[] } } } | null>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    if (!tx) return NextResponse.json({ error: "Transaction not found yet — try again in a few seconds." }, { status: 404 });
    if (tx.meta?.err) return NextResponse.json({ error: "Transaction failed on-chain." }, { status: 400 });
    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? { pubkey: k, signer: false } : k));
    const mintKey = keys.find((k) => k.pubkey === mint);
    if (!mintKey?.signer) return NextResponse.json({ error: "This transaction did not create that mint." }, { status: 400 });
    const creator = keys[0].pubkey;
    const acc = await srpc<MintParsed>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
    const info = acc.value?.data?.parsed?.type === "mint" ? acc.value.data.parsed.info : null;
    if (!info) return NextResponse.json({ error: "Mint account not found." }, { status: 400 });
    // Name/symbol from Metaplex metadata (verified on-chain, not from the request).
    const { tokenMetadata } = await import("@/lib/launch/metadata");
    const md = await tokenMetadata(mint).catch(() => null);
    await q(
      `insert into token_launches (mint, chain, name, symbol, creator, signature, metadata_uri, fixed_supply, freeze_revoked, supply, decimals)
       values ($1,'solana',$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (mint) do nothing`,
      [mint, md?.name ?? "Unknown", md?.symbol ?? "?", creator, signature, md?.uri ?? null, info.mintAuthority === null, info.freezeAuthority === null, info.supply, info.decimals],
    );
    return NextResponse.json({ ok: true, mint, fixedSupply: info.mintAuthority === null, freezeRevoked: info.freezeAuthority === null });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 503 });
  }
}

/** Recent launches made through Bajar. */
export async function GET() {
  try {
    const rows = await q("select mint, chain, name, symbol, creator, signature, fixed_supply, freeze_revoked, supply, decimals, created_at from token_launches order by created_at desc limit 50");
    return NextResponse.json({ launches: rows }, { headers: { "cache-control": "public, max-age=15" } });
  } catch {
    return NextResponse.json({ launches: [], unavailable: true });
  }
}
