// Attack-style checks against a running server. Run: NODE_USE_ENV_PROXY=1 node tests/integration/auth-security.mjs
import { createJiti } from "jiti";
import { testKey } from "./keys.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../src", import.meta.url).pathname } });
const { deriveAll, pqSign, solanaSign } = await jiti.import("../../src/lib/bajar/keys.ts");
const BASE = process.env.BASE ?? "http://localhost:3000";
let fails = 0;
const check = (ok, label, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); if (!ok) fails++; };
const cookieOf = (r, name) => r.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(name + "="));

const k = testKey("owner-a");
// 1. A sign-in challenge cookie must never work as a session (purpose binding).
const n1 = await fetch(`${BASE}/api/auth/nonce?chainType=solana&address=${k.address}`);
const nonceCookie = cookieOf(n1, "sb_nonce");
const forged = nonceCookie.replace("sb_nonce=", "sb_session=");
const s1 = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: forged } })).json();
check(s1.session === null, "challenge token rejected as a session");
const me = await (await fetch(`${BASE}/api/treasury/me`, { headers: { cookie: forged } })).json();
check(!me.actor, "challenge token gives no treasury identity");

// 2. Invalid address formats are refused.
const bad = await fetch(`${BASE}/api/auth/nonce?chainType=evm&address=not-an-address`);
check(bad.status === 400, "invalid address refused", String(bad.status));

// 3. Cross-site sign-in POST is blocked.
const { message } = await n1.json();
const cs = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: nonceCookie, origin: "https://evil.example" }, body: JSON.stringify({ signature: k.sign(message) }) });
check(cs.status === 403, "cross-origin verify blocked", String(cs.status));

// 4. Valid sign-in succeeds once; replaying the same challenge + signature fails.
const ok = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: nonceCookie }, body: JSON.stringify({ signature: k.sign(message) }) });
check(ok.status === 200 && !!cookieOf(ok, "sb_session"), "valid sign-in", String(ok.status));
const replay = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: nonceCookie }, body: JSON.stringify({ signature: k.sign(message) }) });
check(replay.status === 409, "replayed challenge rejected", String(replay.status));

// 5. Wrong signature rejected.
const n2 = await fetch(`${BASE}/api/auth/nonce?chainType=solana&address=${k.address}`);
const wrong = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: cookieOf(n2, "sb_nonce") }, body: JSON.stringify({ signature: k.sign("something else") }) });
check(wrong.status === 401, "wrong signature rejected", String(wrong.status));

// 6. Hybrid sign-in: Ed25519 valid but ML-DSA-65 missing/wrong ⇒ rejected; both valid ⇒ session.pq set.
const { pub, secret } = deriveAll("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const hy = async (pqOk) => {
  const r = await fetch(`${BASE}/api/auth/nonce?chainType=solana&address=${pub.solana.address}&pqPublicKey=${encodeURIComponent(pub.pq.publicKey)}`);
  const m = (await r.json()).message;
  return fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: cookieOf(r, "sb_nonce") }, body: JSON.stringify({ signature: solanaSign(secret.solana, m), pqSignature: pqSign(secret.pq, pqOk ? m : m + "x", "auth"), pqPublicKey: pub.pq.publicKey }) });
};
check((await hy(false)).status === 401, "hybrid: bad ML-DSA-65 signature rejected");
const good = await (await hy(true)).json();
check(good.session?.pq?.alg === "ML-DSA-65", "hybrid: both signatures verified", good.session?.pq?.fingerprint);

// 7. RPC relay: method allowlist, size caps, cross-site block.
const rpc = (body, headers = {}) => fetch(`${BASE}/api/wallet/rpc`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
check((await rpc({ chain: "ethereum", method: "eth_accounts", params: [] })).status === 403, "rpc: non-allowlisted method blocked");
check((await rpc({ chain: "solana", method: "sendTransaction", params: ["A".repeat(5000)] })).status === 400, "rpc: oversized transaction blocked");
check((await rpc({ chain: "ethereum", method: "eth_sendRawTransaction", params: ["not-hex"] })).status === 400, "rpc: malformed raw tx blocked");
check((await rpc({ chain: "ethereum", method: "eth_blockNumber", params: [] }, { "sec-fetch-site": "cross-site" })).status === 403, "rpc: cross-site request blocked");
const bb = await fetch(`${BASE}/api/wallet/btc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hex: "zz" }) });
check(bb.status === 400, "btc broadcast: malformed hex blocked");

// 8. Address screening.
const risk = await (await fetch(`${BASE}/api/wallet/check-address?network=ethereum&address=0x098B716B8Aaf21512996dC57EB0615e2383E2f96`)).json();
check(risk.flags?.some((f) => f.code === "malicious"), "known-malicious EVM address flagged", risk.flags?.map((f) => f.code).join(","));
const usdc = await (await fetch(`${BASE}/api/wallet/check-address?network=ethereum&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`)).json();
check(usdc.flags?.some((f) => f.code === "contract"), "token contract flagged as contract");
const prog = await (await fetch(`${BASE}/api/wallet/check-address?network=solana&address=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)).json();
check(prog.flags?.some((f) => f.code === "program"), "Solana program address flagged");
const btcBad = await (await fetch(`${BASE}/api/wallet/check-address?network=bitcoin&address=bc1qnotvalid`)).json();
check(btcBad.valid === false, "invalid BTC address flagged");

console.log(fails ? `${fails} check(s) failed` : "all checks passed");
process.exit(fails ? 1 : 0);
