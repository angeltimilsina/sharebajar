import { describe, expect, it } from "vitest";
import * as btcSigner from "@scure/btc-signer";
import { hex } from "@scure/base";
import { deriveAll, pqSign, pqVerify } from "@/lib/bajar/keys";
import { planSend, signSend, signPsbt, describePsbt, signBitcoinMessage, verifyBitcoinMessage, DUST_P2WPKH, type Utxo } from "@/lib/bajar/btc";
import { toBase, fromBase, canonicalJson } from "@/lib/bajar/util";
import { selectEvmFee, checkFeeBps, type FeeCandidate } from "@/lib/treasury/fees";
import { classify } from "@/lib/treasury/classify";
import { btcScriptType } from "@/lib/treasury/adapters/bitcoin";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const { pub, secret } = deriveAll(M, 0);
const ME = pub.bitcoin.address;
const TO = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const utxos: Utxo[] = [
  { txid: "a".repeat(64), vout: 0, value: 50_000 },
  { txid: "b".repeat(64), vout: 1, value: 20_000 },
  { txid: "c".repeat(64), vout: 2, value: 5_000 },
];

describe("Bitcoin send planning", () => {
  it("selects largest-first with change", () => {
    const p = planSend(utxos, TO, 30_000, 5, ME);
    expect(p.inputs).toHaveLength(1);
    expect(p.amount + p.fee + p.change).toBe(50_000);
    expect(p.change).toBeGreaterThan(DUST_P2WPKH);
  });
  it("sweeps max minus fee with no change", () => {
    const p = planSend(utxos, TO, "max", 2, ME);
    expect(p.inputs).toHaveLength(3);
    expect(p.change).toBe(0);
    expect(p.amount + p.fee).toBe(75_000);
  });
  it("rejects dust, bad fee rate, insufficient funds, bad address", () => {
    expect(() => planSend(utxos, TO, 100, 2, ME)).toThrow(/at least/);
    expect(() => planSend(utxos, TO, 10_000, 0.5, ME)).toThrow(/Fee rate/);
    expect(() => planSend(utxos, TO, 80_000, 2, ME)).toThrow(/Insufficient/);
    expect(() => planSend(utxos, "0xabc", 10_000, 2, ME)).toThrow(/Invalid/);
  });
  it("signs a valid P2WPKH transaction whose outputs match the plan", () => {
    const p = planSend(utxos, TO, 30_000, 5, ME);
    const s = signSend(p, TO, ME, secret.bitcoin);
    const tx = btcSigner.Transaction.fromRaw(hex.decode(s.hex));
    expect(tx.id).toBe(s.txid);
    expect(tx.outputsLength).toBe(2);
    expect(Number(tx.getOutput(0).amount)).toBe(30_000);
    expect(Number(tx.getOutput(1).amount)).toBe(p.change);
    // fee rate actually achieved is within 1 sat/vB of the plan
    expect(Math.abs(p.fee / s.vsize - 5)).toBeLessThan(1);
  });
});

describe("PSBT signing (provider routes)", () => {
  const myScript = btcSigner.p2wpkh(pub.bitcoin.publicKey ? hex.decode(pub.bitcoin.publicKey) : new Uint8Array(), btcSigner.NETWORK).script;
  const build = (script: Uint8Array) => {
    const tx = new btcSigner.Transaction();
    tx.addInput({ txid: "d".repeat(64), index: 0, witnessUtxo: { script, amount: BigInt(100_000) } });
    tx.addOutputAddress(TO, BigInt(60_000), btcSigner.NETWORK);
    tx.addOutputAddress(ME, BigInt(39_000), btcSigner.NETWORK);
    return hex.encode(tx.toPSBT());
  };
  it("describes and signs only our inputs without altering outputs", () => {
    const psbt = build(myScript);
    const d = describePsbt(psbt);
    expect(d.fee).toBe(1_000);
    expect(d.inputAddresses).toEqual([ME]);
    const s = signPsbt(psbt, secret.bitcoin);
    expect(s.outputs.map((o) => [o.address, Number(o.amount)])).toEqual([[TO, 60_000], [ME, 39_000]]);
  });
  it("refuses a PSBT with no inputs of ours", () => {
    const other = btcSigner.p2wpkh(hex.decode("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"), btcSigner.NETWORK).script;
    expect(() => signPsbt(build(other), secret.bitcoin)).toThrow();
  });
});

describe("BIP-137 message signatures", () => {
  it("round-trips and rejects tampering / wrong address", () => {
    const sig = signBitcoinMessage(secret.bitcoin, "Bajar treasury ownership");
    expect(verifyBitcoinMessage(ME, "Bajar treasury ownership", sig)).toBe(true);
    expect(verifyBitcoinMessage(ME, "Bajar treasury ownership!", sig)).toBe(false);
    expect(verifyBitcoinMessage(TO, "Bajar treasury ownership", sig)).toBe(false);
  });
});

describe("Hybrid PQ sign-in signature", () => {
  it("ML-DSA-65 signature is context-bound", () => {
    const msg = "example.com wants you to sign in\nPost-Quantum Key (ML-DSA-65): abc";
    const sig = pqSign(secret.pq, msg, "auth");
    expect(pqVerify(pub.pq.publicKey, msg, sig, "auth")).toBe(true);
    expect(pqVerify(pub.pq.publicKey, msg, sig, "backup")).toBe(false);
  });
});

describe("amount helpers", () => {
  it("parses decimal amounts exactly", () => {
    expect(toBase("1.5", 6)).toBe(BigInt(1_500_000));
    expect(toBase("0.00000001", 8)).toBe(BigInt(1));
    expect(toBase("0.123", 2)).toBeNull();
    expect(toBase("abc", 6)).toBeNull();
    expect(fromBase(BigInt(1_500_000), 6)).toBe("1.5");
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
  });
});

describe("treasury fee extensions", () => {
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const cand = (preferUsdc?: boolean): FeeCandidate => ({ treasuryId: "t", status: "active", mode: "integrator", bps: 30, preferUsdc, tokens: [
    { token: WETH, symbol: "WETH", decimals: 18, account: "0x1" }, { token: USDC, symbol: "USDC", decimals: 6, account: "0x1" }] });
  it("prefers USDC as the 0x fee token when one side is USDC", () => {
    const d = selectEvmFee([cand()], USDC, WETH, false);
    expect(d.applied && d.symbol).toBe("USDC");
  });
  it("falls back to buy-token preference when disabled", () => {
    const d = selectEvmFee([cand(false)], USDC, WETH, false);
    expect(d.applied && d.symbol).toBe("WETH");
  });
  it("validates the cross-chain fee range", () => {
    expect(checkFeeBps("lifi:cross_chain", 50)).toBeNull();
    expect(checkFeeBps("lifi:cross_chain", 0)).not.toBeNull();
  });
  it("BTC inflow is revenue only with a matching cross-chain intent", () => {
    const base = { direction: "in" as const, isFeeAccount: true, treasuryKind: "wallet", swapProgramInvoked: false, txFailed: false };
    expect(classify({ ...base, intent: null }).isRevenue).toBe(false);
    expect(classify({ ...base, intent: { mode: "cross_chain", expectedFee: "500", slippageBps: 100, providerShareBps: 0 } }).isRevenue).toBe(true);
  });
  it("detects bitcoin script types", () => {
    expect(btcScriptType(ME)).toBe("p2wpkh");
    expect(btcScriptType("bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3")).toBe("p2wsh");
    expect(btcScriptType("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297")).toBe("p2tr");
  });
});
