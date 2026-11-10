import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { srpc } from "@/lib/treasury/solana";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { cached } from "@/lib/server/cache";

type Ix = { program?: string; parsed?: { type?: string; info?: { mint?: string } } };
type Tx = { meta: { err: unknown; innerInstructions?: { instructions: Ix[] }[] } | null; transaction: { message: { accountKeys: ({ pubkey: string } | string)[]; instructions: Ix[] } } } | null;

/** Mints created in the wallet's last 60 transactions where it paid the fee (cached 10 min). */
function createdMints(owner: string) {
  return cached(`created-mints:${owner}`, "Solana RPC", { ttlMs: 10 * 60_000, staleMs: 60 * 60_000 }, async () => {
    const sigs = await srpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [owner, { limit: 60 }]);
    const ok = sigs.filter((x) => !x.err).map((x) => x.signature);
    const out = new Set<string>();
    for (let i = 0; i < ok.length; i += 6) {
      const txs = await Promise.all(ok.slice(i, i + 6).map((sig) => srpc<Tx>("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]).catch(() => null)));
      for (const t of txs) {
        if (!t || t.meta?.err) continue;
        const payer = t.transaction.message.accountKeys[0];
        if ((typeof payer === "string" ? payer : payer.pubkey) !== owner) continue;
        const all = [...t.transaction.message.instructions, ...(t.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)];
        for (const ix of all) if ((ix.program === "spl-token" || ix.program === "spl-token-2022") && /^initializeMint2?$/.test(ix.parsed?.type ?? "") && ix.parsed?.info?.mint) out.add(ix.parsed.info.mint);
      }
    }
    return [...out];
  });
}

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

/**
 * Tokens a Solana wallet created: mints it holds where it is still the mint
 * authority or the metadata update authority. Lets the Portfolio show your
 * launches even if they were never recorded.
 */
export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get("owner") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) return NextResponse.json({ error: "Invalid owner" }, { status: 400 });
  const rl = rateLimit(`ldisc:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    type Acc = { account: { data: { parsed?: { info: { mint: string; tokenAmount: { amount: string } } } } } };
    let blocked = false;
    const lists = await Promise.all(PROGRAMS.map((programId) => srpc<{ value: Acc[] }>("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]).catch(() => { blocked = true; return { value: [] as Acc[] }; })));
    const held = lists.flatMap((l) => l.value).filter((a) => a.account.data.parsed && a.account.data.parsed.info.tokenAmount.amount !== "0").map((a) => a.account.data.parsed!.info.mint);
    // Many public RPC nodes refuse that lookup: also scan the wallet's recent transactions for mints it created.
    const created = blocked || !held.length ? (await createdMints(owner)).data : [];
    const mints = [...new Set([...created, ...held])].slice(0, 100);
    if (!mints.length) return NextResponse.json({ tokens: [] });
    const createdSet = new Set(created);
    const mds = mints.map((m) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), new PublicKey(m).toBuffer()], METADATA_PROGRAM)[0].toBase58());
    const [mintAccs, mdAccs] = await Promise.all([
      srpc<{ value: ({ data: { parsed?: { info: { mintAuthority: string | null } } } } | null)[] }>("getMultipleAccounts", [mints, { encoding: "jsonParsed" }]),
      srpc<{ value: ({ data: [string, string] } | null)[] }>("getMultipleAccounts", [mds, { encoding: "base64" }]),
    ]);
    const tokens = mints.flatMap((mint, i) => {
      const mintAuth = mintAccs.value[i]?.data.parsed?.info.mintAuthority ?? null;
      let updateAuth: string | null = null, name = "", symbol = "";
      const raw = mdAccs.value[i]?.data?.[0];
      if (raw) {
        try {
          const b = Buffer.from(raw, "base64");
          updateAuth = new PublicKey(b.subarray(1, 33)).toBase58();
          let o = 65;
          const str = () => { const n = b.readUInt32LE(o); o += 4; const s = b.subarray(o, o + n).toString("utf8").replace(/\0+$/, ""); o += n; return s; };
          name = str().slice(0, 32); symbol = str().slice(0, 10);
        } catch { /* unreadable metadata */ }
      }
      return mintAuth === owner || updateAuth === owner || createdSet.has(mint) ? [{ mint, chain: "solana", name: name || "Unknown", symbol: symbol || "?", mintAuthority: mintAuth === owner, updateAuthority: updateAuth === owner }] : [];
    });
    return NextResponse.json({ tokens }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ tokens: [], error: String(e instanceof Error ? e.message : e).slice(0, 160) });
  }
}
