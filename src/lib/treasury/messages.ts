/** Human-readable statements signed by wallets (never transactions). */
export function ownershipMessage(t: { chain: string; environment: string; address: string; kind: string }, issuedAt: string) {
  return [
    "ShareBajar treasury ownership verification",
    `Network: ${t.chain} (${t.environment})`,
    `Treasury: ${t.address}`,
    `Kind: ${t.kind}`,
    `Issued At: ${issuedAt}`,
    "This signature proves control of the receiving address. It does not authorise any transaction and never reveals a key.",
  ].join("\n");
}

