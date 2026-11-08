import { describe, expect, it } from "vitest";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { deriveAll, isValidMnemonic, normalizeMnemonic, phraseWords, solanaAddressFor, PHRASE_LENGTHS } from "@/lib/bajar/keys";
import { createVault, openVault } from "@/lib/bajar/vault";
import { analyzePhrase } from "@/lib/bajar/security";

const P = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const ABOUT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("phrase parsing (what users actually paste)", () => {
  const variants: Record<string, string> = {
    "zero-width space between words (the 11-word bug)": P.replace(" wave", "​wave"),
    "zero-width joiner inside a word": P.replace("winner", "win‍ner"),
    "byte-order mark at start": "﻿" + P,
    commas: P.split(" ").join(","),
    "comma + space": P.split(" ").join(", "),
    "numbered list from a notes app": P.split(" ").map((w, i) => `${i + 1}. ${w}`).join("\n"),
    "numbered, no space": P.split(" ").map((w, i) => `${i + 1}.${w}`).join(" "),
    "numbered with parentheses": P.split(" ").map((w, i) => `${i + 1}) ${w}`).join("  "),
    "capitals + autocorrect punctuation": P.replace("legal", "Legal").replace("thank", "Thank,").replace("yellow", "yellow."),
    "non-breaking spaces + tabs": P.replace(/ /g, (_m, o) => (o % 3 ? " " : "\t")),
    "thin / ideographic spaces": P.replace(" year", " year").replace(" worth", "　worth"),
    "quotes around the phrase": `"${P}"`,
    "full-width letters (NFKD)": P.replace("legal", "ｌｅｇａｌ"),
  };
  for (const [name, v] of Object.entries(variants)) {
    it(name, () => {
      expect(phraseWords(v)).toHaveLength(12);
      expect(isValidMnemonic(v)).toBe(true);
      expect(normalizeMnemonic(v)).toBe(P);
      expect(analyzePhrase(v, isValidMnemonic(v)).invalidWords).toEqual([]);
    });
  }
  it("same addresses regardless of formatting", () => {
    expect(deriveAll(variants["numbered list from a notes app"]).pub.evm.address).toBe(deriveAll(P).pub.evm.address);
  });
});

describe("all BIP-39 lengths", () => {
  for (const n of PHRASE_LENGTHS) {
    it(`${n} words`, () => {
      const m = generateMnemonic(wordlist, (n / 3) * 32);
      expect(m.split(" ")).toHaveLength(n);
      expect(isValidMnemonic(m)).toBe(true);
      expect(analyzePhrase(m, true).validCount).toBe(true);
      expect(deriveAll(m).pub.bitcoin.address).toMatch(/^bc1q/);
    });
  }
  it("rejects other lengths and wrong checksums", () => {
    expect(isValidMnemonic(ABOUT.split(" ").slice(0, 11).join(" "))).toBe(false);
    expect(isValidMnemonic(ABOUT.replace("about", "above"))).toBe(false);
  });
});

describe("BIP-39 passphrase and Solana schemes", () => {
  it("a passphrase derives a different wallet (and is case-sensitive)", () => {
    const a = deriveAll(ABOUT).pub, b = deriveAll(ABOUT, { passphrase: "TREZOR" }).pub, c = deriveAll(ABOUT, { passphrase: "trezor" }).pub;
    expect(b.evm.address).not.toBe(a.evm.address);
    expect(b.evm.address).not.toBe(c.evm.address);
  });
  it("standard scheme matches Phantom; legacy scheme differs", () => {
    expect(solanaAddressFor(ABOUT, "standard")).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    expect(solanaAddressFor(ABOUT, "bip44")).not.toBe(solanaAddressFor(ABOUT, "standard"));
    expect(deriveAll(ABOUT, { solanaPath: "bip44" }).pub.solana.address).toBe(solanaAddressFor(ABOUT, "bip44"));
    expect(deriveAll(ABOUT, { solanaPath: "bip44" }).pub.solana.path).toBe("m/44'/501'/0'");
  });
});

describe("vault v2 secret", () => {
  const kdf = { N: 2 ** 15, r: 8, p: 1 };
  it("round-trips phrase + passphrase + Solana scheme", async () => {
    const { pub, secret } = deriveAll(ABOUT, { passphrase: "x y z", solanaPath: "bip44" });
    const v = await createVault({ mnemonic: ABOUT, passphrase: "x y z", solanaPath: "bip44" }, "correct horse battery", pub, secret.pq, kdf);
    expect(v.version).toBe(2);
    expect(await openVault(v, "correct horse battery")).toEqual({ mnemonic: ABOUT, passphrase: "x y z", solanaPath: "bip44" });
  });
});
