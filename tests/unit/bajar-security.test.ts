import { describe, expect, it, beforeEach } from "vitest";
import { passwordStrength, analyzePhrase, suggestWords, quizChoices, quizPositions, throttleDelayMs, localRecipientChecks } from "@/lib/bajar/security";
import { assertVaultShape, createVault, openVault, needsKdfUpgrade, DEFAULT_KDF } from "@/lib/bajar/vault";
import { deriveAll, isValidMnemonic } from "@/lib/bajar/keys";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("password policy", () => {
  it("rejects short, common, sequential and repeated passwords", () => {
    for (const pw of ["short1!", "password123456", "qwertyuiop1234", "aaaaaaaaaaaaaaa", "123456789012345", "MyBitcoinWallet1"]) expect(passwordStrength(pw).ok).toBe(false);
  });
  it("accepts long random-ish passphrases", () => {
    for (const pw of ["correct horse battery staple", "T7#mQ2v!xL9p$zR4", "orbit-lantern-quiet-maple-29"]) expect(passwordStrength(pw).ok).toBe(true);
  });
  it("penalises reuse of the wallet address", () => {
    expect(passwordStrength("0x9858EfFD232B4033", ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]).issues.join(" ")).toMatch(/address|name/);
  });
});

describe("recovery phrase analysis", () => {
  it("flags public test phrases, unknown words and checksum", () => {
    const r = analyzePhrase(M, isValidMnemonic(M));
    expect(r.publicPhrase && r.checksumOk && r.validCount).toBe(true);
    const bad = analyzePhrase("abandon abandn abandon", false);
    expect(bad.invalidWords).toEqual([1]);
    expect(bad.validCount).toBe(false);
    const swapped = M.replace("about", "above");
    expect(isValidMnemonic(swapped)).toBe(false);
  });
  it("suggests corrections for typos", () => {
    expect(suggestWords("abandn")).toContain("abandon");
    expect(suggestWords("zoo")).toContain("zoo");
  });
  it("quiz choices always contain the right word, without duplicates", () => {
    const words = deriveAll(M) && M.split(" ");
    const pos = quizPositions(12, 3);
    expect(new Set(pos).size).toBe(3);
    for (const p of pos) { const c = quizChoices(words, p); expect(c).toContain(words[p]); expect(new Set(c).size).toBe(c.length); }
  });
});

describe("unlock throttling", () => {
  it("allows 3 free attempts then backs off exponentially, capped at 1h", () => {
    expect([0, 1, 2].map(throttleDelayMs)).toEqual([0, 0, 0]);
    expect(throttleDelayMs(3)).toBe(30_000);
    expect(throttleDelayMs(4)).toBe(60_000);
    expect(throttleDelayMs(20)).toBe(3_600_000);
  });
});

describe("recipient checks", () => {
  const own = ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"];
  const used = "0x1234567890abcdef1234567890abcdef12345678";
  it("detects address poisoning look-alikes", () => {
    const fake = "0x12345aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5678";
    expect(localRecipientChecks(fake, { own, history: [used] }).some((f) => f.code === "poisoning" && f.severity === "danger")).toBe(true);
  });
  it("flags self-sends, token contracts, first-time recipients and large amounts", () => {
    const codes = (to: string, o: Partial<Parameters<typeof localRecipientChecks>[1]> = {}) => localRecipientChecks(to, { own, history: [used], ...o }).map((f) => f.code);
    expect(codes(own[0].toLowerCase())).toContain("self");
    expect(codes("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", { tokenAddresses: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"] })).toContain("token_contract");
    expect(codes("0xffffffffffffffffffffffffffffffffffffffff")).toContain("first_time");
    expect(codes(used, { amountShareOfBalance: 0.8 })).toEqual(["large"]);
  });
});

describe("vault validation", () => {
  const { pub, secret } = deriveAll(M);
  let vault: Awaited<ReturnType<typeof createVault>>;
  beforeEach(async () => { vault ??= await createVault(M, "correct horse battery", pub, secret.pq, { N: 2 ** 15, r: 8, p: 1 }); });
  it("rejects malicious KDF parameters before doing any work", () => {
    expect(() => assertVaultShape({ ...vault, kdf: { ...vault.kdf, N: 2 ** 30 } })).toThrow(/safe range/);
    expect(() => assertVaultShape({ ...vault, kdf: { ...vault.kdf, N: 2 ** 10 } })).toThrow(/safe range/);
    expect(() => assertVaultShape({ ...vault, cipher: { ...vault.cipher, iv: "AAAA" } })).toThrow(/malformed/);
    expect(() => assertVaultShape({ format: "other" })).toThrow();
  });
  it("detects weaker-than-default vaults for transparent upgrade", async () => {
    expect(needsKdfUpgrade(vault)).toBe(DEFAULT_KDF.N > 2 ** 15);
    expect(await openVault(vault, "correct horse battery")).toBe(M);
  });
});
