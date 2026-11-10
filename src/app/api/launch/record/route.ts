import { NextResponse } from "next/server";
import { z } from "zod";
import { q } from "@/lib/treasury/db";
import { srpc } from "@/lib/treasury/solana";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const B58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,90}$/);
// groupKey: a random secret the browser creates for one multi-network launch. Only its hash is stored
// (as group_id), so nobody else can attach their token to your launch.
const GroupKey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{30,60}$/).optional();
const Body = z.object({ signature: B58, mint: B58, groupKey: GroupKey });
const EvmBody = z.object({ chain: z.enum(["ethereum", "base", "bsc"]), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), groupKey: GroupKey });
const groupId = async (k?: string) => (k ? Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bajar-launch-group:${k}`))).toString("hex").slice(0, 32) : null);

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
  const raw = await req.json().catch(() => null);
  const evm = EvmBody.safeParse(raw);
  if (evm.success) {
    try {
      const { recordEvmLaunch } = await import("@/lib/launch/evmRecord");
      const r = await recordEvmLaunch(evm.data.chain, evm.data.hash, await groupId(evm.data.groupKey));
      return NextResponse.json(r.ok ? r : { error: r.error }, { status: r.ok ? 200 : r.status });
    } catch (e) {
      return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 503 });
    }
  }
  const p = Body.safeParse(raw);
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
      `insert into token_launches (mint, chain, name, symbol, creator, signature, metadata_uri, fixed_supply, freeze_revoked, supply, decimals, group_id)
       values ($1,'solana',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (mint) do nothing`,
      [mint, md?.name ?? "Unknown", md?.symbol ?? "?", creator, signature, md?.uri ?? null, info.mintAuthority === null, info.freezeAuthority === null, info.supply, info.decimals, await groupId(p.data.groupKey)],
    );
    return NextResponse.json({ ok: true, mint, fixedSupply: info.mintAuthority === null, freezeRevoked: info.freezeAuthority === null });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 503 });
  }
}

/** Recent launches made through Bajar. */
export async function GET(req: Request) {
  const creator = new URL(req.url).searchParams.get("creator");
  if (creator && !/^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(creator)) return NextResponse.json({ error: "Invalid creator" }, { status: 400 });
  try {
    const cols = "mint, chain, name, symbol, creator, signature, fixed_supply, freeze_revoked, supply, decimals, created_at";
    const rows = creator
      ? await q(`select ${cols} from token_launches where lower(creator) = lower($1) order by created_at desc limit 50`, [creator])
      : await q(`select ${cols} from token_launches order by created_at desc limit 50`);
    return NextResponse.json({ launches: rows }, { headers: { "cache-control": "public, max-age=15" } });
  } catch {
    return NextResponse.json({ launches: [], unavailable: true });
  }
}
