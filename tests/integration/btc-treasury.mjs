// BTC treasury flow against a running dev server (monitor-only test address, no funds moved).
// Run: NODE_USE_ENV_PROXY=1 node tests/integration/btc-treasury.mjs
import { createJiti } from "jiti";
import { testKey } from "./keys.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../src", import.meta.url).pathname } });
const { deriveAll } = await jiti.import("../../src/lib/bajar/keys.ts");
const { signBitcoinMessage } = await jiti.import("../../src/lib/bajar/btc.ts");
const BASE = process.env.BASE ?? "http://localhost:3000";
const { pub, secret } = deriveAll("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", 0);
const BTC = pub.bitcoin.address;
let fails = 0;
const check = (ok, label, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); if (!ok) fails++; };
function client(name) {
  const k = testKey(name); const jar = {};
  const req = async (p, body, method) => {
    const r = await fetch(BASE + p, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json", cookie: Object.entries(jar).map(([a, b]) => `${a}=${b}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [ck, cv] = kv.split("="); if (cv) jar[ck] = cv; else delete jar[ck]; }
    return r.json();
  };
  return {
    req,
    async signIn() { const n = await req(`/api/auth/nonce?chainType=solana&address=${k.address}`); await req("/api/auth/verify", { signature: k.sign(n.message) }); },
    async propose(action, payload) { const p = await req("/api/treasury/changes", { prepare: true, action, payload }); return req("/api/treasury/changes", { action, payload, issuedAt: p.issuedAt, signature: k.sign(p.message) }); },
    async approve(id) { const m = await req(`/api/treasury/changes/${id}`, { op: "message" }); return req(`/api/treasury/changes/${id}`, { op: "approve", signature: k.sign(m.message) }); },
  };
}
const a = client("owner-a"), b = client("owner-b");
await a.signIn(); await b.signIn();
const insp = await a.req("/api/treasury/inspect", { chain: "bitcoin", environment: "mainnet", kind: "wallet", address: BTC });
check(insp.ok && insp.receivingAddress === BTC, "inspect bitcoin address", `${insp.facts?.scriptType}, warnings: ${insp.warnings?.length}`);
let t = (await a.req("/api/treasury/treasuries")).treasuries.find((x) => x.address === BTC);
if (!t) {
  const r = await a.propose("register_treasury", { chain: "bitcoin", environment: "mainnet", kind: "wallet", address: BTC, label: "[TEST] BTC fee wallet (monitor only)", expectedReceivingAddress: BTC });
  const ap = await b.approve(r.change.id);
  check(ap.change?.status === "applied", "register (dual approval)", ap.error ?? "");
  t = (await a.req("/api/treasury/treasuries")).treasuries.find((x) => x.address === BTC);
}
check(t?.chainType === "bitcoin", "treasury stored as bitcoin");
if (!t.ownership) {
  const m = await a.req(`/api/treasury/treasuries/${t.id}`, { op: "ownership-message" });
  const bad = await a.req(`/api/treasury/treasuries/${t.id}`, { op: "verify-ownership", signer: BTC, message: m.message, signature: signBitcoinMessage(secret.bitcoin, m.message + "x") });
  check(!!bad.error, "rejects wrong BIP-137 signature", bad.error);
  const ok = await a.req(`/api/treasury/treasuries/${t.id}`, { op: "verify-ownership", signer: BTC, message: m.message, signature: signBitcoinMessage(secret.bitcoin, m.message) });
  check(!ok.error, "BIP-137 ownership verified", ok.error ?? "");
}
const f = await a.propose("update_fees", { treasuryId: t.id, feeConfig: { feeBps: 50, tokens: [] } });
const fa = f.change?.status === "applied" ? f : await b.approve(f.change.id);
check(fa.change?.status === "applied", "cross-chain fee config (50 bps, BTC)", fa.error ?? "");
t = (await a.req(`/api/treasury/treasuries/${t.id}`)).treasury;
check(t.feeConfig?.provider === "lifi" && t.feeConfig?.mode === "cross_chain" && t.feeConfig?.tokens[0]?.symbol === "BTC", "fee config stored", JSON.stringify(t.feeConfig));
const v = await a.req(`/api/treasury/treasuries/${t.id}`, { op: "validate" });
console.log("  validation:", (v.results ?? []).map((r) => `${r.key}:${r.outcome}`).join(" "));
const s = await a.req(`/api/treasury/index?treasury=${t.id}&rescan=1`, {}, "POST");
check(!s.summary?.errors?.length, "indexed BTC address", JSON.stringify(s.summary ?? s));
const rev = await a.req("/api/treasury/revenue?filter=all");
const evs = rev.events.filter((e) => e.chain === "bitcoin");
check(evs.every((e) => !e.is_revenue), "BTC deposits without a swap intent are transfers, not revenue", `${evs.length} event(s)`);
const bal = await a.req(`/api/treasury/treasuries/${t.id}/balances`);
check(Array.isArray(bal.balances), "BTC balance", JSON.stringify(bal.balances?.map((x) => `${x.symbol} ${x.amount}`)));
const l = await a.req("/api/treasury/ledger");
check(l.integrity?.ok !== false, "ledger integrity", JSON.stringify(l.integrity));
console.log(fails ? `${fails} check(s) failed` : "all checks passed");
process.exit(fails ? 1 : 0);
