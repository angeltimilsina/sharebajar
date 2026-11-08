// Simulates the full token-launch transaction on Solana mainnet (no signatures,
// nothing is sent) to verify every instruction encodes and executes correctly.
// Run: NODE_USE_ENV_PROXY=1 node tests/integration/launch-simulate.mjs
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../src", import.meta.url).pathname } });
const L = await jiti.import("../../src/lib/launch/solanaToken.ts");
const RPC = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
const rpc = async (method, params) => { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const b = await r.json(); if (b.error) throw new Error(JSON.stringify(b.error)); return b.result; };
// Public, well-funded address used only as the simulated fee payer.
const PAYER = process.env.SIM_PAYER || "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const bal = await rpc("getBalance", [PAYER]);
console.log("payer balance SOL", bal.value / 1e9);
const { value: { blockhash } } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
const rentMint = await rpc("getMinimumBalanceForRentExemption", [L.MINT_SIZE]);
let fails = 0;
for (const [label, opts] of [
  ["fixed supply, no freeze, immutable", { revokeMint: true, revokeFreeze: true, immutable: true }],
  ["mintable, freezable, mutable", { revokeMint: false, revokeFreeze: false, immutable: false }],
]) {
  const { tx, mintAddress } = await L.buildLaunchTransaction({
    payer: PAYER, name: "Bajar Launch Test", symbol: "BJTEST", uri: "https://www.sharebajar.com/api/launch/metadata/test",
    decimals: 6, supply: 1_000_000_000n, ...opts, launchFee: null,
  }, { blockhash, rent: { mint: rentMint } });
  const b64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  const sim = await rpc("simulateTransaction", [b64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  const ok = sim.value.err === null;
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${label} — mint ${mintAddress.slice(0, 8)}…, ${sim.value.unitsConsumed} CU, size ${Buffer.from(b64, "base64").length} bytes${ok ? "" : ` err=${JSON.stringify(sim.value.err)}`}`);
  if (!ok) console.log((sim.value.logs ?? []).slice(-12).join("\n"));
  else console.log("   ", (sim.value.logs ?? []).filter((l) => /Program (metaq|Tokenkeg|ATok).* success|Instruction: (InitializeMint2|MintTo|SetAuthority|Create Metadata)/.test(l)).slice(0, 10).join(" | "));
}
console.log(fails ? `${fails} failed` : "all simulations passed");
process.exit(fails ? 1 : 0);
