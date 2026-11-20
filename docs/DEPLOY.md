# Deploying Bajar to Vercel with your own domain

Bajar is a standard Next.js app, so Vercel runs it without extra setup. `vercel.json` pins the US East region (`iad1`), because Binance's public market-data hosts are geo-restricted in some regions. It also gives the AI route up to 120 s.

## 1. Import the project

1. Sign in at https://vercel.com with GitHub.
2. **Add New → Project →** import `angeltimilsina/sharebajar`.
3. Under **Git**, set the production branch to `claude/sharebajar-crypto-marketplace-sf5x88` (or merge it into `main` first).
4. Framework preset: **Next.js** (auto-detected). Leave the build and output settings at their defaults.

## 2. Environment variables

Add these in **Project → Settings → Environment Variables** (Production):

| Name | Value | Needed? |
| --- | --- | --- |
| `SESSION_SECRET` | a long random string, e.g. the output of `openssl rand -hex 32` | **Yes** (wallet sign-in) |
| `NEXT_PUBLIC_SITE_URL` | `https://yourdomain.com` | **Yes** (SEO, sitemap) |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | your Solana RPC URL (Helius, QuickNode, Triton…) | Strongly recommended (balances, swaps) |
| `ANTHROPIC_API_KEY` | your Anthropic API key | Only to enable the AI assistant |
| `RPC_URL_ETHEREUM`, `RPC_URL_BASE`, … | your own RPC nodes | Optional |

Market data needs no keys. Click **Deploy**. You get a `*.vercel.app` URL in about 2 minutes.

## 3. Connect your domain

1. **Project → Settings → Domains → Add** `yourdomain.com`. Also add `www.yourdomain.com` and choose to redirect it to the apex (or the other way round).
2. Vercel shows the DNS records it expects. They are normally:

| Type | Name / Host | Value |
| --- | --- | --- |
| `A` | `@` (apex, `yourdomain.com`) | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

   **Always copy the exact values shown in your Vercel dashboard.** Vercel sometimes assigns project-specific values.
3. Add those records at your registrar:
   - **GoDaddy:** My Products → Domain → DNS → Manage DNS → Add record. Edit the existing `@` A record instead of adding a second one.
   - **Namecheap:** Domain List → Manage → Advanced DNS → Add new record. Delete the default "parking" records.
   - **Cloudflare:** DNS → Records. Set the proxy status to **DNS only** (grey cloud) for these two records.
   - Alternatively, point the domain's **nameservers** to `ns1.vercel-dns.com` and `ns2.vercel-dns.com` and let Vercel manage DNS.
4. Remove any other `A`/`AAAA` records on `@` and any conflicting `www` records.
5. DNS usually propagates within minutes; it can take up to 48 hours. Vercel issues the HTTPS certificate automatically once the records resolve. The domain then shows **Valid Configuration**.
6. Update `NEXT_PUBLIC_SITE_URL` to the final domain if needed, then redeploy (**Deployments → … → Redeploy**).

## Notes

- Every push to the production branch redeploys automatically. Other branches get preview URLs.
- The cache and rate limiter are in-memory per serverless instance. This works fine to start. For heavy traffic, add Redis (Upstash on the Vercel Marketplace).
- On the Hobby plan, functions are capped at a shorter duration than 120 s. Long AI answers may be cut off; the Pro plan honours `maxDuration`.
