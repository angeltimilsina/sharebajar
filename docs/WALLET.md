# BAJAR Wallet

BAJAR Wallet is ShareBajar's built-in noncustodial wallet for **Bitcoin, Ethereum/EVM and Solana**, at `/wallet`.

> **Development build.** It must pass thorough testing and an independent security audit before anyone keeps meaningful funds in it. Until then, treat it as experimental software.

## What it does

| Area | Details |
|---|---|
| Accounts | One BIP-39 phrase (12 or 24 words). Bitcoin native SegWit `m/84'/0'/0'/0/0` (P2WPKH), EVM `m/44'/60'/0'/0/0` (same address on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche), Solana `m/44'/501'/0'/0'` (SLIP-10). Compatible with other standard wallets. |
| Create / import | Create with confirmation of 3 random words, import a phrase, or restore an encrypted backup file. |
| Storage | The phrase is encrypted in the browser: scrypt (N=2^17, r=8, p=1) → AES-256-GCM, with authenticated metadata. Stored in `localStorage` (`bajar.vault.v1`). Decrypted keys live in memory only while unlocked, and are wiped on lock. Auto-lock after inactivity (default 10 min). |
| Balances | Live on-chain: mempool.space (BTC), public RPC for every EVM chain and Solana. USDC, USDT, WBTC/cbBTC and any custom token you add after on-chain validation. Prices come from live exchange/on-chain sources, and assets without a reliable price are shown as "not valued". |
| Send | BTC (coin selection, fee-rate presets from mempool.space, change back to you), EVM native and ERC-20 (gas estimate, `eth_call` simulation, EIP-1559 fees), SOL and SPL/Token-2022 (creates the recipient's token account if missing, simulation). |
| Receive | QR codes plus copyable addresses for each network. |
| Swap | See **Universal swaps** below. |
| Activity | Bitcoin and Solana history comes from the networks. EVM shows transactions sent from this device, with explorer links for the rest. |
| dApp provider | BAJAR shows up in **Connect wallet** as *BAJAR Wallet · Solana* and *BAJAR Wallet · EVM*, so the existing Trade, Portfolio and Treasury pages work with it. |

## Security model

- **Keys never leave the browser.** The server only ever receives public addresses, signed transactions and signatures. `/api/wallet/rpc` is an allowlisted read/broadcast relay: it cannot sign anything.
- **Explicit approval for every signature.** Every message, transaction, token approval, swap and bridge step opens the BAJAR approval dialog. It shows the network, accounts, amounts, network fee, simulation result and any ShareBajar fee. Nothing is signed until you click **Approve**. Token approvals are for the exact amount, never unlimited.
- **Separate from the treasury.** The wallet's signing code (`src/lib/bajar/*`, browser only) shares no keys, storage or code paths with BAJAR Treasury (`src/lib/treasury/*`). The treasury never signs: it builds unsigned transactions for the owners' own multisig wallets.
- **ShareBajar never asks for your recovery phrase.** The only place it is ever typed is the import screen of your own wallet, on your own device.

## Post-quantum (ML-DSA-65) protection: what it does and doesn't do

BAJAR derives an **ML-DSA-65** (NIST FIPS 204) key pair from your phrase (`HMAC-SHA512("BAJAR/ML-DSA-65/v1", seed)` → 32-byte seed). It is used for:

1. **Hybrid sign-in.** The ShareBajar sign-in message includes your PQ key fingerprint. The server verifies **both** the Ed25519 signature and the ML-DSA-65 signature (context `BAJAR-AUTH-v1`), and records `pq` on the session.
2. **Backups.** Encrypted backup files are signed (`BAJAR-BACKUP-v1`). Restore rejects tampered files.
3. **Authorization log.** Every approval you give is recorded locally with a SHA-256 digest of the request and an ML-DSA-65 signature (`BAJAR-TX-AUTH-v1`).

**Limits:** Bitcoin, Ethereum and Solana do **not** support ML-DSA signatures today. On-chain transactions are still signed with each network's own scheme (secp256k1 ECDSA/Schnorr, Ed25519), so funds on these networks are **not** quantum-resistant. The PQ layer is a supplementary protection for authentication, backups and records only. The key format is versioned (`keyScheme`, `PQ_DERIVATION`) so the scheme can be upgraded later.

## Universal swaps

| Route | Provider | ShareBajar fee |
|---|---|---|
| Same-chain Solana (SOL, USDC, USDT, SPL) | Jupiter Swap V2 | 0.30% where supported and a treasury is active |
| Same-chain EVM (ETH, USDC, USDT, WBTC, cbBTC) | 0x Swap API | 0.30% where supported (USDC preferred as fee token) |
| Cross-chain, and anything with **native BTC** | LI.FI (NEAR Intents, Layerswap, bridges) | **0.50%**, replacing the swap fee. Only charged when `LIFI_INTEGRATOR` is set **and** an active treasury exists on the source chain |

- The fee shown in the quote is the fee that is actually charged. If a provider doesn't apply it, the quote says so and nothing is charged.
- **Wrapped BTC is labeled as such everywhere.** WBTC and cbBTC are tokens backed by a custodian or bridge, not native bitcoin.
- Native-BTC routes return a PSBT. BAJAR shows every input and output, and signs only its own inputs without changing the provider's data (LI.FI requires this).
- Cross-chain delivery is tracked through LI.FI's status API. Quotes expire after 60 s and are refreshed before signing.

## Not available yet

- **WalletConnect:** needs a WalletConnect Cloud project ID, so it isn't enabled.
- **Hardware wallets:** not supported in BAJAR. Use Ledger/Trezor through their own apps or extensions with the regular wallet picker.
- Multiple accounts per phrase (index > 0) and testnets.

## Environment

| Variable | Purpose |
|---|---|
| `LIFI_INTEGRATOR` | Integrator name registered at portal.li.fi. Required for the cross-chain fee. |
| `LIFI_API_KEY` | Optional LI.FI API key (higher rate limits). |
| `CROSS_CHAIN_FEE_BPS` | Default cross-chain fee (50 = 0.50%). Per-treasury override in the treasury fee settings. |
| `MEMPOOL_API_URL` | mempool.space-compatible API (default public mempool.space). |
| `TOKEN_LAUNCH_FEE_USDC` | Configurable token launch fee. Disclosed, but not collected until on-platform token creation exists. |

## Tests

- `tests/unit/bajar-keys.test.ts`: BIP-84/BIP-44/SLIP-10 known-answer vectors, ML-DSA sizes, vault round-trip and tamper detection.
- `tests/unit/bajar-wallet.test.ts`: BTC coin selection and signing, PSBT signing and refusal, BIP-137, PQ context binding, amount parsing, USDC fee preference, BTC revenue classification.
- `tests/integration/btc-treasury.mjs`: Bitcoin treasury registration, BIP-137 ownership, fee config, indexing and ledger integrity (against a running server).
- `tests/e2e/wallet-bajar.spec.ts`: import, balances, receive addresses, live swap quote, hybrid sign-in, lock.
