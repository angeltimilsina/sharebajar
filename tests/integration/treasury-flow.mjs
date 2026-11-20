// End-to-end treasury flow against a running server (real chain reads).
// Usage: BASE=http://localhost:3000 node tests/integration/treasury-flow.mjs
import { testKey } from "./keys.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

class Client {
  constructor(key) { this.key = key; this.cookies = {}; }
  async req(path, { method, body } = {}) {
    const r = await fetch(BASE + path, { method: method ?? (body ? "POST" : "GET"), headers: { ...(body ? { "content-type": "application/json" } : {}), cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v) this.cookies[k] = v; else delete this.cookies[k]; }
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: r.status, json };
  }
  async signIn() {
    const n = await this.req(`/api/auth/nonce?chainType=solana&address=${this.key.address}`);
    const v = await this.req("/api/auth/verify", { body: { signature: this.key.sign(n.json.message) } });
    return v.json.ok;
  }
  async propose(action, payload) {
    const p = await this.req("/api/treasury/changes", { body: { prepare: true, action, payload } });
    if (p.status !== 200) return p;
    return this.req("/api/treasury/changes", { body: { action, payload, issuedAt: p.json.issuedAt, signature: this.key.sign(p.json.message) } });
  }
  async approve(id) {
    const m = await this.req(`/api/treasury/changes/${id}`, { body: { op: "message" } });
    return this.req(`/api/treasury/changes/${id}`, { body: { op: "approve", signature: this.key.sign(m.json.message) } });
  }
}

const a = new Client(testKey("owner-a"));
const b = new Client(testKey("owner-b"));
const stranger = new Client(testKey("stranger"));
const treasuryKey = testKey(`treasury-${Date.now()}`); // fresh, unfunded test treasury wallet

// --- access control
const anon = await new Client(testKey("anon")).req("/api/treasury/treasuries");
check("unauthenticated access is rejected (401)", anon.status === 401);
await stranger.signIn();
const s1 = await stranger.req("/api/treasury/treasuries");
check("signed-in non-admin wallet is rejected (401)", s1.status === 401);
check("owner A signs in with wallet signature", await a.signIn());
check("owner B signs in with wallet signature", await b.signIn());
const me = await a.req("/api/treasury/me");
check("owner role resolved", me.json.actor?.role === "owner", `approvals required: ${me.json.config.requiredApprovals}`);

// --- register via dual control
const insp = await a.req("/api/treasury/inspect", { body: { chain: "solana", kind: "wallet", address: treasuryKey.address } });
check("on-chain inspection of new wallet", insp.json.ok === true, insp.json.warnings?.join(" "));
const bad = await a.req("/api/treasury/inspect", { body: { chain: "solana", kind: "wallet", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" } });
check("program accounts are refused as wallet treasuries", bad.json.ok === false, bad.json.errors?.[0]);
const forged = await a.req("/api/treasury/changes", { body: { action: "register_treasury", payload: { chain: "solana", kind: "wallet", address: treasuryKey.address, label: "x", expectedReceivingAddress: treasuryKey.address }, issuedAt: new Date().toISOString(), signature: b.key.sign("not the right message") } });
check("change request with a forged signature is rejected", forged.status === 401);
const reg = await a.propose("register_treasury", { chain: "solana", environment: "mainnet", kind: "wallet", address: treasuryKey.address, vaultIndex: 0, label: "Integration test treasury", expectedReceivingAddress: insp.json.receivingAddress });
const needsApproval = reg.json.change?.status === "pending";
check("registration is a pending change request", needsApproval || reg.json.change?.status === "applied", reg.json.change?.status ?? JSON.stringify(reg.json));
if (needsApproval) {
  const self = await a.approve(reg.json.change.id);
  check("requester cannot approve own change", self.status === 403);
  const ok = await b.approve(reg.json.change.id);
  check("second admin approves with wallet signature → applied", ok.json.change?.status === "applied", ok.json.error);
}
const list = await a.req("/api/treasury/treasuries");
const t = list.json.treasuries.find((x) => x.address === treasuryKey.address);
check("treasury registered with integrity seal", !!t && t.integrityOk && t.status === "registered");

// --- ownership
const om = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "ownership-message" } });
const wrong = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "verify-ownership", signer: a.key.address, message: om.json.message, signature: a.key.sign(om.json.message) } });
check("ownership signature from a different wallet is rejected", wrong.status === 400, wrong.json.error);
const own = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "verify-ownership", signer: treasuryKey.address, message: om.json.message, signature: treasuryKey.sign(om.json.message) } });
check("treasury wallet signature verifies ownership", own.json.treasury?.status === "verified", own.json.error);

// --- fees
const badFee = await a.propose("update_fees", { treasuryId: t.id, feeConfig: { feeBps: 5000, tokens: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"] } });
let badFeeRejected = badFee.status >= 400;
if (!badFeeRejected && badFee.json.change?.status === "pending") { const r = await b.approve(badFee.json.change.id); badFeeRejected = r.status >= 400; }
check("fee above provider/platform cap is refused", badFeeRejected);
const fee = await a.propose("update_fees", { treasuryId: t.id, feeConfig: { feeBps: 30, tokens: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "So11111111111111111111111111111111111111112"] } });
if (fee.json.change?.status === "pending") await b.approve(fee.json.change.id);
const t2 = (await a.req(`/api/treasury/treasuries/${t.id}`)).json.treasury;
check("fee config validated on-chain and applied (30 bps, USDC+SOL)", t2.feeConfig?.feeBps === 30 && t2.feeConfig.tokens.length === 2, t2.feeConfig?.tokens.map((x) => `${x.symbol}→${x.tokenAccount?.slice(0, 6)}`).join(", "));

// --- token accounts + validation
const acc = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "check-accounts" } });
check("fee token accounts checked on-chain (unfunded wallet: not initialized)", acc.json.accounts?.every((x) => x.initialized === false));
const initTx = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "init-accounts-tx", payer: treasuryKey.address } });
check("unsigned ATA-initialization transaction built + simulated", typeof initTx.json.transaction === "string" && initTx.json.created?.length === 2, `simulation: ${JSON.stringify(initTx.json.simulation?.err)} (unfunded payer expected to fail)`);
const val = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "validate" } });
const byKey = Object.fromEntries((val.json.results ?? []).map((r) => [r.key, r.outcome]));
check("validation blocks activation while fee accounts are missing", byKey.fee_accounts === "fail" && byKey.ownership === "pass" && byKey.integrity === "pass", JSON.stringify(byKey));
const act = await a.propose("activate", { treasuryId: t.id });
let actRefused = act.status >= 400;
if (!actRefused && act.json.change?.status === "pending") { const r = await b.approve(act.json.change.id); actRefused = r.status >= 400 || r.json.change?.status === "failed"; }
check("activation refused without validation + confirmed test fee", actRefused);
const testing = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "set-status", status: "testing" } });
check("testing mode refused before validation", testing.status === 409);

// --- swaps: fee is not applied for an inactive treasury
const q = await stranger.req(`/api/swap/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=50000000&slippageBps=50`);
check("public swap quote discloses no fee when treasury not active", q.json.data?.fee?.applied === false, q.json.data?.fee?.reason);
const badIntent = await stranger.req("/api/treasury/intents", { body: { intentToken: "forged.token-value-xxxxxxxx", txHash: "5".repeat(88) } });
check("forged swap intent rejected", badIntent.status === 400);

// --- indexer + dashboard
const idx = await a.req("/api/treasury/index", { method: "POST" });
check("reconciliation run completes", !!idx.json.summary, JSON.stringify(idx.json.summary ?? idx.json));
const dash = await a.req("/api/treasury/dashboard");
check("dashboard aggregates load", dash.status === 200 && Array.isArray(dash.json.treasuries));
const ledger = await a.req("/api/treasury/ledger");
check("ledger hash chain verifies", ledger.json.integrity?.ok === true, `${ledger.json.integrity?.entries} entries`);
const auditLog = await a.req("/api/treasury/audit");
check("denied attempts are in the audit log", auditLog.json.entries.some((e) => e.outcome === "denied"));
const csv = await fetch(`${BASE}/api/treasury/revenue?format=csv`, { headers: { cookie: Object.entries(a.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } });
check("revenue CSV export", csv.status === 200);

// --- disable is immediate
const dis = await a.req(`/api/treasury/treasuries/${t.id}`, { body: { op: "set-status", status: "disabled" } });
check("emergency disable is immediate", dis.json.treasury?.status === "disabled");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
