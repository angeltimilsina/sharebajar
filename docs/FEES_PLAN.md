# Platform fees — implementation plan

Owner: product owner · Lead: `fees-lead` agent · Status: **Phase 0 in progress** (DATABASE_URL added 2026-11-09)

## Goal
Collect disclosed platform fees on swaps and trades — Solana (Jupiter), EVM (0x), cross-chain (LI.FI) and optionally token launches — into multisig-controlled treasuries, prove every fee on-chain, and never let fee problems block trading.

## Where we are (verified 2026-11-09)
- **Code complete:** fee policy (default 30 bps, platform cap 100 bps), per-provider rules, treasury registry with two-owner approvals and integrity seals, on-chain validation, testing mode (fees only on admin wallets), activation gating, sealed fee intents, daily reconciliation, hash-chained ledger, revenue export, emergency disable, fee disclosure before signing.
- **Fail-safe:** if the treasury store is unreachable, swaps run with no platform fee and the quote says so (fixed 2026-11-09; previously every quote failed in production).
- **Production:** `DATABASE_URL` set (Production target); redeploy started 16:30 UTC. No treasuries registered yet → fees currently off.
- **Tests:** treasury flow 29/29 on a fresh store; unit 164/164.

## Decisions needed from the owner
| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Fee rate | 30 bps on Solana (Jupiter platform mode) and EVM (0x); 50 bps cross-chain (LI.FI); token launch fee 0 at first |
| D2 | Solana fee route | **Platform mode** (/build): Bajar keeps 100%, fee in the output token. Referral mode (/order) only if broader token coverage matters more than the 20% Jupiter share and the 50 bps minimum |
| D3 | Custody | Squads v4 vault (Solana) + Safe (EVM, same address across chains), **2-of-3** signers on hardware wallets, signers ≠ any Bajar Wallet used for trading |
| D4 | Fee tokens | Solana: USDC, wSOL, USDT (ATAs required). EVM: USDC, USDT, WETH per chain, prefer USDC |
| D5 | Phase-1 networks | Solana, Base, Ethereum, Arbitrum; then Optimism, Polygon, BNB, Avalanche |
| D6 | Disclosure | Fee line in Terms + "Fees" help page; in-app disclosure already shown before every signature |

## Phases
### Phase 0 — Production readiness (day 0–1) · owner: qa-release-engineer
- Confirm the new deployment is READY and `/api/health` → `integrations.treasury.configured = true`.
- Tables are created on first use; confirm admin sign-in at `/admin/treasury` with a `TREASURY_OWNERS` wallet; confirm `TREASURY_REQUIRED_APPROVALS = 2`.
- Turn on database backups / point-in-time restore at the provider.
- Set `SOLANA_RPC_URL` (dedicated provider) so validation and reconciliation don't hit public-RPC limits.
- **Exit:** health green, both owners can sign in, backups on.

### Phase 1 — Custody (day 1–3) · owner: treasury-custody-engineer, review: security-reviewer
- Create the Squads vault and the Safe(s) with the agreed signers (D3).
- Send and withdraw a small test amount through each multisig.
- **Exit:** multisig addresses recorded in the plan, 2-of-3 confirmed by a real round-trip.

### Phase 2 — Register treasuries in testing mode (day 3–4) · owner: treasury-custody-engineer
- Admin → Treasury → register each multisig (two-owner approval), prove ownership, set fee config (D1, D4).
- Initialise fee token accounts (Solana ATAs), run validation until all required checks pass.
- **Exit:** every phase-1 treasury `testing`, validation green.

### Phase 3 — Test fees with real swaps (day 4–6) · owner: swap-fee-integration-engineer + reconciliation-engineer
- With an admin wallet, run small real swaps per network and route: Jupiter build, Jupiter order fallback, 0x buy/sell, native-coin sells, a USDC-output and a non-fee-token output.
- Check: quote shows the fee with a TEST badge; fee arrives on-chain in the treasury; reconciliation matches expected within tolerance; no orphaned receipts.
- **Exit:** at least one confirmed test fee per network and route; reconciliation clean.

### Phase 4 — Activate gradually (day 6–10) · owner: fees-lead, review: security-reviewer
- Activate Solana first; watch 48 h: quote success rate, share of swaps with a fee, reconciliation orphans, revenue chart, user complaints. Then activate EVM chains one by one.
- Kill switch: emergency disable per treasury (immediate).
- **Exit:** all phase-1 networks active for 7 days without incidents.

### Phase 5 — Cross-chain and launch fees (week 2–3) · owner: swap-fee-integration-engineer
- LI.FI: register integrator, set the fee wallet in the LI.FI portal, confirm `feeSplit` in quotes.
- Optional token-launch fee via `TOKEN_LAUNCH_FEE_USDC` (charged only with an active Solana treasury; disclosed before signing).
- **Exit:** cross-chain fee confirmed on a real bridge; launch fee decision recorded.

### Phase 6 — Operations (ongoing) · owner: reconciliation-engineer
- Daily reconciliation cron (Vercel Hobby = daily; Pro allows hourly) + manual "run now".
- Alerts: integrity failures, orphaned fees, cron failures, treasury status changes.
- Monthly revenue CSV; withdrawals only via multisig + change request; signer rotation and incident runbook in docs/TREASURY.md.

## Guardrails (non-negotiable)
- Fees only when the provider confirms them, always disclosed before signing.
- Fee errors never block trading.
- Treasury signing fully separate from Bajar Wallet customer signing; no treasury key on any server.
- Every treasury transaction and config change needs multisig / two-owner approval.
- No mock balances, fabricated prices or simulated executions in production.

## Risks
- **Fee coverage (Solana platform mode):** fee only on swaps whose output token has a treasury ATA → cover the most-bought outputs (USDC, SOL, USDT); measure coverage in Phase 3.
- **Jupiter order route:** Jupiter chooses the fee mint; if the referral token account is missing the fee is dropped (disclosed).
- **0x:** native ETH can't be a fee token; selling ETH→token charges the token side.
- **Cron limits:** daily-only reconciliation on Hobby delays revenue visibility, not collection.
- **Public RPC limits:** set `SOLANA_RPC_URL` before Phase 2.

## KPIs
Quote success rate (≥ 99%), fee-applied share of swaps, fee revenue per network, reconciliation match rate (100% matched or explained), orphaned receipts (0), time to detect integrity failures (< 24 h).

## Agent roles (`.claude/agents/`)
| Role | Owns |
|------|------|
| `fees-lead` | Plan, sequencing, exit checks, delegation |
| `treasury-custody-engineer` | Multisigs, registration, fee accounts, validation, activation |
| `swap-fee-integration-engineer` | Jupiter / 0x / LI.FI fee wiring and in-app disclosure |
| `reconciliation-engineer` | Indexer, ledger, revenue, cron, alerts |
| `security-reviewer` | Read-only review of anything touching keys, approvals or money |
| `qa-release-engineer` | Tests, builds, deploys, production verification |
