# Bajar Treasury

Noncustodial revenue collection, monitoring and accounting at `/admin/treasury`.

## Principles

- **No keys in Bajar.** Treasury wallets and multisigs are created in external apps: Phantom/Solflare, Squads, MetaMask, Safe, or the Jupiter referral dashboard. Bajar stores only **public** addresses and never asks for recovery phrases or private keys.
- **Revenue counts only when fees arrive on-chain.** Quotes, swap volume and reported transactions are never counted as revenue.
- **Every fee is disclosed before signing.** If a route can't carry the fee, the user sees "No platform fee" and none is charged or claimed.
- **No backend signing.** Outgoing operations are built and simulated unsigned. They execute only after treasury wallet or multisig approval: in the wallet itself, through a Safe Transaction Builder batch, or as a Squads proposal.

## Fee routes (verified against current provider docs and live APIs)

| Network | Provider | Mechanism | Rate | Fee token | Provider share |
| --- | --- | --- | --- | --- | --- |
| Solana | Jupiter Swap V2 `/build` | `platformFeeBps` + `feeAccount` | any (default **30 bps**) | output token (live check: exactly 0.30% of output) | none |
| Solana | Jupiter Swap V2 `/order` | `referralAccount` + `referralFee` | **50–255 bps** | Jupiter picks (SOL > stables > …) | Jupiter keeps **20%** |
| EVM | 0x Swap API (AllowanceHolder) | `swapFeeRecipient`, `swapFeeBps`, `swapFeeToken` | up to 1000 bps (default **30**) | **USDC preferred** when either side is USDC (toggle), else buy then sell token (ERC-20 only) | none; 0x charges its own fee, shown separately |
| Cross-chain (any source chain incl. **Bitcoin**) | LI.FI `integrator` + `fee` | Paid by LI.FI directly to the Partner Portal fee wallet (FeeForwarder on EVM) | **50 bps** default (`CROSS_CHAIN_FEE_BPS`, per-treasury override), **replaces** the swap fee | source token | LI.FI may keep a share depending on plan (`feeSplit` in the quote) |

Cross-chain fees are only requested when `LIFI_INTEGRATOR` is set **and** an active treasury exists on the source chain. The LI.FI Partner Portal fee wallet for that chain must be the registered treasury address, which validation reminds you of.

### Bitcoin treasuries

Bitcoin (native BTC) treasuries receive LI.FI cross-chain fees on BTC-source routes.
- Register any mainnet address. Multisig (P2WSH/P2SH descriptor wallets, e.g. Sparrow, Nunchuk or Casa) is strongly recommended.
- Ownership is proven with a **BIP-137** message signature (P2WPKH/P2PKH). BIP-322 (script/multisig addresses) is not verified yet.
- The indexer reads the address via mempool.space and tracks confirmations (3 required) and reorgs (orphaned if dropped). An inflow counts as **revenue only when it matches a disclosed cross-chain swap intent** for that exact transaction. Every other inflow is recorded as a transfer.
- Fee ledger entries link each fee to its originating swap through the intent (`intent_id`, `tx_hash`), with provider attribution taken from the intent (`jupiter` / `0x` / `lifi`).

### Token launch fee

`TOKEN_LAUNCH_FEE_USDC` configures a USDC launch fee, shown in the admin config. It is disclosed but **not collected**: Bajar's Launchpad lists external launches and has no on-platform token creation yet.

The 30 bps default is below Jupiter's referral minimum. Solana wallet/Squads treasuries therefore use `/build`. Jupiter referral treasuries start at 50 bps.

## Setup flow

1. **Network** — choose the chain and environment.
2. **Create externally** — wallet, Squads multisig, Safe, or Jupiter referral account.
3. **Register** — on-chain inspection (Safe owners/threshold, Squads members/vault PDA, referral partner/project). This creates a signed change request.
4. **Verify ownership** — a text signature from the treasury wallet, a Safe owner, a Squads member, or the referral partner.
5. **Fee tokens & rate** — validated on-chain against provider rules. This is also a signed change request.
6. **Token accounts** (Solana) — idempotent ATA creation, paid and signed by an admin wallet.
7. **Validate** — integrity seal, ownership, on-chain state, fee accounts, a live quote proving the fee is attached, and API keys.
8. **Test → activate** — in *testing*, only admin wallets pay the fee (TEST badge). Activation requires a confirmed test fee, passing validation and a second approval.

## Security controls

- **Wallet sign-in for admins.** Roles are viewer / operator / admin / owner. Owners are bootstrapped with `TREASURY_OWNERS`. Sensitive actions need a fresh sign-in.
- **Dual control.** Register, fee changes, activation and role changes each need wallet signatures from different admins over the payload hash (`TREASURY_REQUIRED_APPROVALS`).
- **AES-256-GCM encryption** of fee configuration. **HMAC integrity seals** over each treasury's address, kind, status, fees and ownership: a record edited directly in the database is flagged and excluded from fee routing.
- **Address allowlist.** Transfers can only go to other registered, ownership-verified treasuries.
- **Audit log** of every action and every denied attempt. **Alerts** (DB + webhook) for change requests, integrity failures, missing fees, reconciliation mismatches, outgoing transfers, reorgs and unauthorized access.
- **Sealed swap intents.** Expected-fee figures come from the server, never from the browser.
- **Emergency disable** takes effect immediately.

## Revenue engine

- **Scanning.** Each treasury's fee/referral token accounts and receiving address are scanned: Solana via `getSignaturesForAddress` + parsed transactions, EVM via ERC-20 `Transfer` logs.
- **Classification.** An inflow into a dedicated fee account inside a swap is revenue. A swap means a known aggregator program (Jupiter, DFlow — Jupiter's meta-aggregator also routes through it — or the Referral program) or ≥2 mints moving. Everything else is a transfer.
- **Reconciliation.** Each reported swap intent is checked against the actual fee within slippage + 1%, giving matched / under / over / unexpected. Successful swaps with no fee raise a critical `fee_missing` alert.
- **Confirmations.** Solana revenue counts at `finalized`. EVM uses per-chain thresholds (12–64 blocks). Pending events are re-checked; vanished or reorged events become `orphaned`.
- **Pricing.** Stablecoins are valued at the peg. Majors use the Binance 1-minute close at block time. Others use the current price, with the source labelled.
- **Ledger.** Append-only and hash-chained. Corrections and reclassifications are reversal entries, never edits. CSV exports are available for revenue and ledger.
- **Scheduling.** Vercel Cron runs `/api/treasury/cron` once a day (Hobby plan limit; use `*/10 * * * *` on Pro) with `CRON_SECRET`. Operators can also run reconciliation manually.

## Verification performed

- `tests/integration/treasury-flow.mjs`: 29 end-to-end checks against a live server and real chain reads. They cover access control, forged signatures, dual approval, ownership, fee caps, activation gating, fee disclosure, indexing, ledger, audit, CSV and emergency disable.
- Unit tests: classification, fee policy, encryption, integrity tampering on a real embedded Postgres, governance, ledger tampering and intent forgery.
- Mainnet fixtures: a real Jupiter referral account's fee and claim transactions, including swaps routed via DFlow.
- **Not yet done:** a real test swap paying a fee into a Bajar-owned treasury. That needs your funded treasury wallets and must be done by you (Production validation tab).
