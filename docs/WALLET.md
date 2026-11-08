# Bajar Wallet

Bajar Wallet is Bajar's built-in noncustodial wallet for **Bitcoin, Ethereum/EVM and Solana**, at `/wallet`.

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
| dApp provider | BAJAR shows up in **Connect wallet** as *Bajar Wallet · Solana* and *Bajar Wallet · EVM*, so the existing Trade, Portfolio and Treasury pages work with it. |

## Security model

- **Keys never leave the browser.** The server only ever receives public addresses, signed transactions and signatures. `/api/wallet/rpc` is an allowlisted read/broadcast relay: it cannot sign anything.
- **Explicit approval for every signature.** Every message, transaction, token approval, swap and bridge step opens the BAJAR approval dialog. It shows the network, accounts, amounts, network fee, simulation result and any Bajar fee. Nothing is signed until you click **Approve**. Token approvals are for the exact amount, never unlimited.
- **Separate from the treasury.** The wallet's signing code (`src/lib/bajar/*`, browser only) shares no keys, storage or code paths with Bajar Treasury (`src/lib/treasury/*`). The treasury never signs: it builds unsigned transactions for the owners' own multisig wallets.
- **Bajar never asks for your recovery phrase.** The only place it is ever typed is the import screen of your own wallet, on your own device.

## Wallet flows

| Flow | Steps | Safeguards |
|---|---|---|
| **Create** | Before you start → password → recovery phrase → verify → done | Password policy (≥12 chars, strength ≥ "Strong", no common/crypto words, no address reuse). Phrase is blurred until tapped, hidden again when the tab loses focus, and can't be copied. Backup quiz picks 3 random positions (crypto RNG) with decoy words. |
| **Import** | Recovery phrase → password → done | Per-word BIP-39 check with typo suggestions, checksum check, masked input, best-effort clipboard clearing after paste, warning and opt-in for publicly known test phrases, warning for low-diversity phrases. |
| **Restore** | Backup file → preview → password → done | Size limit, strict schema, scrypt parameters within a safe range (blocks freeze/downgrade files), ML-DSA-65 signature, AES-GCM decryption, then the decrypted phrase must derive exactly the addresses and PQ key in the file. |
| **Unlock** | Password | 3 free attempts, then a timed lock (30 s doubling to 1 h) that persists across reloads. Older vaults are re-encrypted with current settings on unlock. "Forgot password" explains recovery and requires typing REMOVE. |
| **Done** | Checklist + optional sign-in | Shows the device and backup checks, then offers hybrid sign-in. |

## Client-side protections

- Keys exist only in memory while unlocked. Auto-lock (default 10 min) wipes key buffers.
- The vault write is read back and verified before the wallet switches to it.
- **Recipient screening before every send:**
  - Locally it flags your own address, **address-poisoning look-alikes** (same first/last characters as an address you used before), first-time recipients, token contract addresses and sending ≥ 50% of a balance.
  - Server screening (below) adds checks against known-malicious lists and on-chain account types.
  - High-risk results require an explicit acknowledgment. Invalid addresses can't be sent to at all.
- **Security checkup** (Security tab, scored out of 100): HTTPS, not framed, WebCrypto, backup status, password strength, auto-lock, current encryption settings, PQ-verified session.
- A backup reminder shows until a phrase quiz passes or an encrypted backup is downloaded.

## Server-side protections

- **Sign-in challenges** are single-use (replay → 409), expire in 5 minutes, and are bound to the requesting domain and address (plus the ML-DSA-65 key fingerprint for hybrid sign-in). Both signatures must verify.
- **Signed tokens are purpose-bound:** a sign-in challenge token can never be accepted as a session. This fixed an impersonation risk where a challenge cookie could have been replayed as a session.
- **Cookies:** httpOnly, `SameSite`, and `Secure` outside local HTTP dev.
- **CSRF guard** on every state-changing route (`Origin` / `Sec-Fetch-Site`). Cross-site requests also never receive a treasury identity.
- **RPC relay:** method allowlist, per-method shape and size caps (signed Solana tx ≤ 1232 bytes, raw EVM tx ≤ 128 KB), separate broadcast rate limit, 300 KB request cap. Bitcoin broadcast accepts only well-formed hex.
- **`/api/wallet/check-address`:**
  - GoPlus malicious-address data on EVM chains (phishing, drainers, sanctions, etc.).
  - Detects contracts, burn addresses, Solana programs and token accounts, and invalid formats.
- **Headers:**
  - On every page: HSTS, `X-Frame-Options: DENY`, COOP, strict Permissions-Policy and a base CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action`).
  - Wallet pages also get a lockdown CSP (`connect-src 'self'` plus the price stream), so injected scripts can't send data to other hosts, and `Cache-Control: no-store`.

## Post-quantum (ML-DSA-65) protection: what it does and doesn't do

BAJAR derives an **ML-DSA-65** (NIST FIPS 204) key pair from your phrase (`HMAC-SHA512("BAJAR/ML-DSA-65/v1", seed)` → 32-byte seed). It is used for:

1. **Hybrid sign-in.** The Bajar sign-in message includes your PQ key fingerprint. The server verifies **both** the Ed25519 signature and the ML-DSA-65 signature (context `BAJAR-AUTH-v1`), and records `pq` on the session.
2. **Backups.** Encrypted backup files are signed (`BAJAR-BACKUP-v1`). Restore rejects tampered files.
3. **Authorization log.** Every approval you give is recorded locally with a SHA-256 digest of the request and an ML-DSA-65 signature (`BAJAR-TX-AUTH-v1`).

**Limits:** Bitcoin, Ethereum and Solana do **not** support ML-DSA signatures today. On-chain transactions are still signed with each network's own scheme (secp256k1 ECDSA/Schnorr, Ed25519), so funds on these networks are **not** quantum-resistant. The PQ layer is a supplementary protection for authentication, backups and records only. The key format is versioned (`keyScheme`, `PQ_DERIVATION`) so the scheme can be upgraded later.

## Universal swaps

| Route | Provider | Bajar fee |
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
- `tests/unit/bajar-security.test.ts`: password policy, phrase analysis and typo suggestions, quiz generation, throttle schedule, recipient checks (poisoning, self, token contract, large share), vault schema/KDF bounds.
- `tests/integration/auth-security.mjs`: attack-style checks against a running server (challenge-as-session forgery, replay, cross-origin, wrong/missing PQ signature, RPC allowlist and size caps, malformed broadcast, malicious-address screening).
- `tests/e2e/wallet-bajar.spec.ts`: create (weak password refused, reveal, quiz), import (test-phrase warning), receive addresses, wrong-password throttling, unlock, hybrid sign-in with approval, malicious recipient warning.
