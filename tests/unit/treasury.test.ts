import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { classify, reconcile, splitProviderShare, toDecimal } from "@/lib/treasury/classify";
import { checkFeeBps, platformFeeFromNetOut, selectEvmFee, selectSolanaFee, type FeeCandidate } from "@/lib/treasury/fees";

process.env.TREASURY_ENCRYPTION_KEY = "11".repeat(32);
process.env.TREASURY_PGLITE_DIR = "memory://";
process.env.TREASURY_REQUIRED_APPROVALS = "2";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

describe("classification", () => {
  const base = { direction: "in" as const, isFeeAccount: true, treasuryKind: "wallet", intent: null, swapProgramInvoked: false, txFailed: false };
  it("fee from a reported swap is revenue", () => {
    expect(classify({ ...base, intent: { mode: "platform", expectedFee: "100", slippageBps: 50, providerShareBps: 0 } })).toMatchObject({ source: "swap_fee", isRevenue: true, attribution: "intent" });
  });
  it("fee arriving inside a swap without an intent is unattributed revenue", () => {
    expect(classify({ ...base, swapProgramInvoked: true, treasuryKind: "jupiter_referral" })).toMatchObject({ source: "referral_fee", isRevenue: true, attribution: "unattributed" });
  });
  it("plain deposits, outflows and failed txs are never revenue", () => {
    expect(classify(base).isRevenue).toBe(false);
    expect(classify({ ...base, direction: "out" }).source).toBe("transfer_out");
    expect(classify({ ...base, txFailed: true, intent: { mode: "platform", expectedFee: "1", slippageBps: 50, providerShareBps: 0 } }).isRevenue).toBe(false);
    expect(classify({ ...base, isFeeAccount: false, swapProgramInvoked: true }).isRevenue).toBe(false);
  });
  it("splits Jupiter's 20% referral share from the net amount", () => {
    expect(splitProviderShare(BigInt(800), 2000)).toEqual({ gross: BigInt(1000), share: BigInt(200) });
    expect(splitProviderShare(BigInt(800), 0)).toEqual({ gross: BigInt(800), share: BigInt(0) });
  });
  it("reconciles actual vs expected with slippage tolerance", () => {
    expect(reconcile(BigInt(1000), BigInt(1000), 50, true, true)).toBe("matched");
    expect(reconcile(BigInt(900), BigInt(1000), 50, true, true)).toBe("under");
    expect(reconcile(BigInt(1100), BigInt(1000), 50, true, true)).toBe("over");
    expect(reconcile(BigInt(5), null, null, true, false)).toBe("unexpected");
    expect(reconcile(BigInt(5), null, null, false, false)).toBe("not_applicable");
  });
  it("formats raw units exactly", () => {
    expect(toDecimal(BigInt(126314), 6)).toBe("0.126314");
    expect(toDecimal(BigInt("1000000000"), 9)).toBe("1");
    expect(toDecimal(BigInt(-5), 2)).toBe("-0.05");
  });
});

describe("fee policy", () => {
  it("enforces provider-specific ranges and the platform cap", () => {
    expect(checkFeeBps("jupiter:platform", 30)).toBeNull();
    expect(checkFeeBps("jupiter:referral", 30)).toMatch(/50 and 255/);
    expect(checkFeeBps("0x:integrator", 5000)).toMatch(/between 1 and 1000/);
    expect(checkFeeBps("0x:integrator", 500)).toMatch(/cap/);
  });
  it("computes the /build platform fee from the net output (matches live 0.30%)", () => {
    // Live check: 8,935,192 without fee vs 8,908,041 with 30 bps ⇒ fee ≈ 26,8xx
    expect(platformFeeFromNetOut(BigInt(8908041), 30)).toBe(BigInt(26804));
  });
  const cand = (over: Partial<FeeCandidate>): FeeCandidate => ({ treasuryId: "t1", status: "active", mode: "platform", bps: 30, tokens: [{ token: USDC, symbol: "USDC", decimals: 6, account: "FEEACCT", initialized: true }], ...over });
  it("Solana platform fee only when the output token is an enabled fee token", () => {
    expect(selectSolanaFee([cand({})], USDC, false)).toMatchObject({ applied: true, bps: 30, recipient: "FEEACCT" });
    expect(selectSolanaFee([cand({})], SOL, false)).toMatchObject({ applied: false });
    expect(selectSolanaFee([cand({ tokens: [{ token: USDC, symbol: "USDC", decimals: 6, account: "X", initialized: false }] })], USDC, false).applied).toBe(false);
  });
  it("testing treasuries charge only admin (test) swaps", () => {
    expect(selectSolanaFee([cand({ status: "testing" })], USDC, false).applied).toBe(false);
    expect(selectSolanaFee([cand({ status: "testing" })], USDC, true)).toMatchObject({ applied: true, isTest: true });
  });
  it("EVM prefers the buy token and never uses native ETH", () => {
    const evm = cand({ mode: "integrator", tokens: [{ token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, account: "0xT", initialized: true }] });
    expect(selectEvmFee([evm], "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", false)).toMatchObject({ applied: true, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" });
    expect(selectEvmFee([evm], "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "0xdAC17F958D2ee523a2206206994597C13D831ec7", false).applied).toBe(false);
  });
});

describe("real mainnet fixtures", () => {
  const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
  it("detects a referral fee routed through Jupiter", async () => {
    const { solDelta, isSwapTx } = await import("@/lib/treasury/engine");
    const f = load("solana-jupiter-referral-fee.json");
    const d = solDelta(f.tx, f.feeAccount)!;
    expect(d.mint).toBe(USDC);
    expect(d.delta).toBe(BigInt(126314));
    expect(isSwapTx(f.tx, f.feeAccount)).toBe(true);
  });
  it("detects a referral fee routed through DFlow (Jupiter meta-aggregator)", async () => {
    const { solDelta, isSwapTx } = await import("@/lib/treasury/engine");
    const f = load("solana-dflow-referral-fee.json");
    expect(solDelta(f.tx, f.feeAccount)!.delta > BigInt(0)).toBe(true);
    expect(isSwapTx(f.tx, f.feeAccount)).toBe(true);
  });
  it("a referral claim is an outflow, not revenue", async () => {
    const { solDelta } = await import("@/lib/treasury/engine");
    const f = load("solana-referral-claim.json");
    expect(solDelta(f.tx, f.feeAccount)!.delta < BigInt(0)).toBe(true);
  });
});

describe("encryption, integrity and governance (embedded Postgres)", () => {
  beforeAll(async () => { (await import("@/lib/treasury/db")).__useMemoryDb(); });

  it("encrypts configuration and detects tampering", async () => {
    const { encrypt, decrypt, seal, verifySeal } = await import("@/lib/treasury/crypto");
    const c = encrypt({ feeBps: 30 });
    expect(c).not.toContain("30");
    expect(decrypt<{ feeBps: number }>(c)!.feeBps).toBe(30);
    const flipped = c.slice(0, -2) + (c.endsWith("A") ? "B" : "A") + c.slice(-1);
    expect(() => decrypt(flipped)).toThrow();
    const mac = seal({ address: "abc" });
    expect(verifySeal({ address: "abc" }, mac)).toBe(true);
    expect(verifySeal({ address: "evil" }, mac)).toBe(false);
  });

  it("flags a treasury whose receiving address was changed directly in the database", async () => {
    const { insertTreasury, getTreasury, updateTreasury } = await import("@/lib/treasury/store");
    const { q } = await import("@/lib/treasury/db");
    const t = await insertTreasury({ chain: "solana", chainType: "solana", environment: "mainnet", label: "t", address: "7jNZLJhRBLh3beohRjAhh52V1wZ5cFh3pT2afHQqst65", kind: "wallet", inspection: {}, createdBy: "x" });
    expect(t.integrityOk).toBe(true);
    await q("update treasuries set address=$2 where id=$1", [t.id, "AttackerAddress1111111111111111111111111111"]);
    expect((await getTreasury(t.id))!.integrityOk).toBe(false);
    await expect(updateTreasury(t.id, { status: "active" })).rejects.toThrow(/integrity/);
  });

  it("requires a second admin's wallet signature to apply a change", async () => {
    const { createChange, approveChange, requestMessage, approvalMessage, payloadHash } = await import("@/lib/treasury/governance");
    const mk = (n: number) => { const priv = new Uint8Array(32).fill(n); return { priv, address: bs58.encode(ed25519.getPublicKey(priv)) }; };
    const A = mk(7), B = mk(9);
    const actor = (k: typeof A) => ({ address: k.address, chainType: "solana" as const, role: "admin" as const, sessionAgeMs: 0, source: "db" as const });
    const sign = (k: typeof A, m: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(m), k.priv));
    let applied = 0;
    const payload = { treasuryId: "x", feeConfig: { feeBps: 30, tokens: [USDC] } };
    const issuedAt = new Date().toISOString();
    const c = await createChange(actor(A), "update_fees", payload, issuedAt, sign(A, requestMessage("update_fees", payloadHash("update_fees", payload), A.address, issuedAt)), async () => { applied++; });
    expect(c.status).toBe("pending");
    await expect(approveChange(actor(A), c.id, sign(A, approvalMessage(c.id, c.payloadHash, A.address)), async () => { applied++; })).rejects.toThrow(/different admin/);
    await expect(approveChange(actor(B), c.id, sign(B, "wrong message"), async () => { applied++; })).rejects.toThrow(/signature/);
    const done = await approveChange(actor(B), c.id, sign(B, approvalMessage(c.id, c.payloadHash, B.address)), async () => { applied++; });
    expect(done.status).toBe("applied");
    expect(applied).toBe(1);
  });

  it("ledger hash chain detects edits", async () => {
    const { appendLedger, verifyLedger } = await import("@/lib/treasury/ledger");
    const { q } = await import("@/lib/treasury/db");
    await appendLedger([{ eventId: "e1", entryType: "debit", account: "assets:x", token: USDC, amount: "1.5", usdValue: 1.5, memo: "fee" }, { eventId: "e1", entryType: "credit", account: "revenue:x", token: USDC, amount: "1.5", usdValue: 1.5, memo: "fee" }]);
    expect((await verifyLedger()).ok).toBe(true);
    await q("update ledger set amount='150' where event_id='e1' and entry_type='debit'");
    const v = await verifyLedger();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).not.toBeNull();
  });

  it("sealed swap intents cannot be forged or altered", async () => {
    const { issueIntent, readIntent } = await import("@/lib/treasury/intents");
    const tok = issueIntent({ provider: "jupiter", route: "build", chain: "solana", mode: "platform", treasuryId: "t", feeToken: USDC, feeAccount: "F", feeBps: 30, providerShareBps: 0, expectedFee: "100", quoteOut: "1", slippageBps: 50, taker: "T", isTest: false });
    expect(readIntent(tok)!.expectedFee).toBe("100");
    const [body, mac] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), expectedFee: "999999" })).toString("base64url");
    expect(readIntent(`${forged}.${mac}`)).toBeNull();
  });
});
