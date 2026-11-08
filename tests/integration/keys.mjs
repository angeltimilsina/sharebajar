// TEST-ONLY deterministic keys. They sign text messages in tests and never hold funds.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";

export function testKey(name) {
  const priv = sha256(new TextEncoder().encode(`sharebajar-test-key:${name}`));
  return { name, priv, address: bs58.encode(ed25519.getPublicKey(priv)), sign: (msg) => bs58.encode(ed25519.sign(new TextEncoder().encode(msg), priv)) };
}
if (process.argv[2] === "print") console.log(["owner-a", "owner-b"].map((n) => testKey(n).address).join(","));
