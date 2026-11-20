import "server-only";
import { srpc } from "../treasury/solana";

const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/** Read name/symbol/uri from a mint's Metaplex metadata account (on-chain). */
export async function tokenMetadata(mint: string): Promise<{ name: string; symbol: string; uri: string } | null> {
  const { PublicKey } = await import("@solana/web3.js");
  const prog = new PublicKey(METADATA_PROGRAM);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), prog.toBuffer(), new PublicKey(mint).toBuffer()], prog);
  const acc = await srpc<{ value: { data: [string, string] } | null }>("getAccountInfo", [pda.toBase58(), { encoding: "base64" }]);
  if (!acc.value) return null;
  const b = Buffer.from(acc.value.data[0], "base64");
  // key(1) + update_authority(32) + mint(32), then borsh strings (null-padded)
  let o = 65;
  const str = () => { const n = b.readUInt32LE(o); o += 4; const s = b.subarray(o, o + n).toString("utf8").replace(/\0+$/, ""); o += n; return s; };
  return { name: str(), symbol: str(), uri: str() };
}
