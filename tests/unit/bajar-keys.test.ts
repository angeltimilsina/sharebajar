import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { deriveAll, isValidMnemonic, newMnemonic, pqSign, pqVerify, slip10Ed25519 } from "@/lib/bajar/keys";
import { createVault, openVault, verifyVaultSignature } from "@/lib/bajar/vault";

const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

describe("BAJAR key derivation (known-answer vectors)", () => {
  const { pub } = deriveAll(ABANDON);
  it("Bitcoin BIP-84 matches the BIP-84 test vector", () => expect(pub.bitcoin.address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"));
  it("EVM BIP-44 matches the standard test vector", () => expect(pub.evm.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94"));
  it("Solana m/44'/501'/0'/0' matches Phantom/Solflare", () => expect(pub.solana.address).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"));
  it("SLIP-10 Ed25519 test vector 1 (m/0')", () => {
    const k = slip10Ed25519(Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"), "m/0'");
    expect(hex(k)).toBe("68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3");
    expect(hex(ed25519.getPublicKey(k))).toBe("8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c");
  });
  it("ML-DSA-65 identity is deterministic from the phrase (recoverable)", () => {
    expect(deriveAll(ABANDON).pub.pq.publicKey).toBe(pub.pq.publicKey);
    expect(Buffer.from(pub.pq.publicKey, "base64").length).toBe(1952); // FIPS 204 ML-DSA-65 public key size
    expect(pub.pq.fingerprint).toMatch(/^ML-DSA-65:[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
  });
  it("rejects phrases with a bad checksum and generates valid new ones", () => {
    expect(isValidMnemonic(ABANDON.replace("about", "abandon"))).toBe(false);
    expect(() => deriveAll(ABANDON.replace("about", "zoo"))).toThrow(/checksum/);
    const m = newMnemonic();
    expect(m.split(" ")).toHaveLength(12);
    expect(isValidMnemonic(m)).toBe(true);
    expect(newMnemonic(256).split(" ")).toHaveLength(24);
  });
});

describe("ML-DSA-65 signatures", () => {
  const { pub, secret } = deriveAll(ABANDON);
  it("signs and verifies with domain separation", () => {
    const sig = pqSign(secret.pq, "hello", "auth");
    expect(Buffer.from(sig, "base64").length).toBe(3309); // FIPS 204 ML-DSA-65 signature size
    expect(pqVerify(pub.pq.publicKey, "hello", sig, "auth")).toBe(true);
    expect(pqVerify(pub.pq.publicKey, "hello!", sig, "auth")).toBe(false);
    expect(pqVerify(pub.pq.publicKey, "hello", sig, "backup")).toBe(false); // context-bound
  });
});

describe("encrypted vault", () => {
  const { pub, secret } = deriveAll(ABANDON);
  const kdf = { N: 2 ** 10, r: 8, p: 1 }; // fast params for tests; production uses N = 2^17
  it("round-trips and never stores the phrase in plaintext", async () => {
    const v = await createVault(ABANDON, "correct horse battery", pub, secret.pq, kdf);
    expect(JSON.stringify(v)).not.toContain("abandon");
    expect(await openVault(v, "correct horse battery")).toBe(ABANDON);
    await expect(openVault(v, "wrong password!!")).rejects.toThrow(/Wrong password/);
  });
  it("detects tampering with public metadata and verifies the ML-DSA-65 backup signature", async () => {
    const v = await createVault(ABANDON, "correct horse battery", pub, secret.pq, kdf);
    expect(verifyVaultSignature(v)).toBe(true);
    const evil = { ...v, accounts: { ...v.accounts, bitcoin: { ...v.accounts.bitcoin, address: "bc1qattacker" } } };
    expect(verifyVaultSignature(evil)).toBe(false);
    await expect(openVault(evil, "correct horse battery")).rejects.toThrow(); // AAD-bound
  });
  it("enforces a minimum password length", async () => {
    await expect(createVault(ABANDON, "short", pub, secret.pq, kdf)).rejects.toThrow(/at least 10/);
  });
});
