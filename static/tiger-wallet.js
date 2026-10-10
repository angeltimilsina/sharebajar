/** Tiger Wallet integration foundation for Sharebajar.
 * Non-custodial: uses injected wallet providers; never reads seed phrases.
 * This module does not execute trades or deploy contracts.
 */
const hexToBigInt = (hex) => BigInt(hex);
const formatUnits = (amount, decimals) => {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
};
const assertAddress = (value) => {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("Invalid EVM address");
  return value;
};

/** Injected EIP-1193 wallet. Explicit consent is required for connection. */
export async function connectEvmWallet(provider = globalThis.ethereum) {
  if (!provider?.request) throw new Error("No compatible EVM wallet detected");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error("Wallet connection declined");
  const address = assertAddress(accounts[0]);
  const chainId = await provider.request({ method: "eth_chainId" });
  return { address, chainId, provider };
}

export async function getEvmNativeBalance(address, provider = globalThis.ethereum) {
  if (!provider?.request) throw new Error("No compatible EVM wallet detected");
  const balanceHex = await provider.request({
    method: "eth_getBalance",
    params: [assertAddress(address), "latest"],
  });
  return { wei: hexToBigInt(balanceHex).toString(), nativeUnits: formatUnits(hexToBigInt(balanceHex), 18) };
}

/** Explicitly submits a native-coin transfer to the user's wallet for approval. */
export async function requestEvmNativeTransfer({ provider = globalThis.ethereum, from, to, valueWei }) {
  if (!provider?.request) throw new Error("No compatible EVM wallet detected");
  const value = BigInt(valueWei);
  if (value <= 0n) throw new Error("Transfer amount must be positive");
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from: assertAddress(from), to: assertAddress(to), value: `0x${value.toString(16)}` }],
  });
}

/** Connect to a browser-injected Solana wallet such as Phantom. */
export async function connectSolanaWallet(provider = globalThis.phantom?.solana ?? globalThis.solana) {
  if (!provider?.connect) throw new Error("No compatible Solana wallet detected");
  const result = await provider.connect();
  const publicKey = result?.publicKey ?? provider.publicKey;
  if (!publicKey) throw new Error("Solana wallet connection declined");
  return { address: publicKey.toString(), provider };
}

/** Reads SOL balance over a caller-selected RPC; no third-party credentials embedded. */
export async function getSolBalance(address, { rpcUrl = "https://api.mainnet-beta.solana.com", fetchImpl = globalThis.fetch } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error("Invalid Solana address");
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
  });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error || !Number.isSafeInteger(data?.result?.value)) throw new Error("Invalid Solana balance response");
  const lamports = data.result.value;
  return { lamports, sol: formatUnits(BigInt(lamports), 9) };
}
