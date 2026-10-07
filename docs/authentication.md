# Account, Google sign-in, and administrator setup

## Account database

Accounts are stored in a server-owned SQLite database. By default the file is `.data/accounts.sqlite`; set `SHAREBAJAR_ACCOUNT_DB` to select another persistent path. Existing account rows are preserved and extended by additive schema migrations. Historical creation and last-seen timestamps cannot be recovered for legacy accounts, so the admin directory displays them as unavailable until recorded after migration. Keep the database on persistent storage and include it in restricted backups. The SQLite deployment is intended for one application host, not multiple concurrent application replicas.

Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes. Sign-in sessions are revocable and expire after 24 hours. Password reset tokens are stored only as hashes, expire after one hour, can be used once, and invalidate existing sessions when used.

## Local environment setup

The server and account administration commands load the repository-root `.env` automatically at startup. Existing process environment values take precedence. `.env` is git-ignored; `.env.example` contains placeholders only. Fill in the Google credentials in `.env`, set the public URL and exact callback URI for your deployment, and restart the server. For local development, open `http://localhost:3000` so the OAuth state cookie returns to the same host. Changes to `.env` take effect after restarting; the file is not served to browsers.

## Google OAuth

Create a Google OAuth 2.0 Web application client. Set these environment variables for the server process:

```text
SHAREBAJAR_PUBLIC_URL=https://app.example.com
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://app.example.com/api/auth/google/callback
```

Register the exact redirect URI above in the Google Cloud Console. `GOOGLE_REDIRECT_URI` is optional when it matches `${SHAREBAJAR_PUBLIC_URL}/api/auth/google/callback`. The OAuth flow requests OpenID Connect profile and email, checks a short-lived `HttpOnly` state cookie, and accepts only Google-verified email addresses. Google credentials must remain server-side; do not put them in frontend code or commit them.

## Password-reset email

Configure an SMTP server that supports TLS:

```text
SHAREBAJAR_SMTP_HOST=smtp.example.com
SHAREBAJAR_SMTP_PORT=587
SHAREBAJAR_SMTP_USERNAME=mailer-user
SHAREBAJAR_SMTP_PASSWORD=mailer-password
SHAREBAJAR_SMTP_FROM=ShareBajar <noreply@example.com>
```

Port `587` uses STARTTLS; port `465` uses implicit TLS. Username/password are optional only for SMTP relays that permit unauthenticated delivery. `SHAREBAJAR_PUBLIC_URL` must point to the public HTTPS application origin in production so recovery links target the correct site. Requests return the same response for existing and unknown accounts. Missing SMTP configuration is reported uniformly; transient send failures are recorded in the server log without recording the target address or reset token, to prevent account enumeration.

## Administrator access

Create the first user normally, then run this one-time local command against the same environment and database path as the application:

```sh
python manage_users.py promote-admin admin@example.com
```

To use a non-default database, set `SHAREBAJAR_ACCOUNT_DB` for both the server and this command. The admin navigation is shown only to administrator accounts, and every admin API operation is checked server-side. The panel can search the user directory, view email, sign-in methods, role, plan, account status, created time, and last-seen time; it can change plan duration and disable or re-enable an account. Changes are recorded in an audit table. The interface and API never return passwords, password hashes, salts, session tokens, or reset tokens. Administrators cannot disable their own account.

Keep administrator promotion access limited to trusted operators. Run the application behind HTTPS in production, keep SMTP and OAuth secrets out of source control, and restrict access to the SQLite file and its backups.

## Public browsing and account pages

Signed-out visitors see one Explore screen combining asset discovery, price charts, AI questions, and latest news. Old Markets and Charts links lead to that same screen. Asset search, quotes, price history, and crypto market listings remain available for market discovery. Overview, watchlists, portfolios, administrator tools, news, and research require sign-in; paid research still requires the appropriate membership. Signing out immediately returns private views to Markets and removes personal actions from open asset details.

Use `/#signin` and `/#signup` to open the account forms directly. Both forms support the same Google authorization flow, which creates an account for a new verified Google email or signs in an existing account. Configure the Google environment variables above before starting the server; the button stays disabled until configuration is available. For local development, register `http://localhost:3000/api/auth/google/callback` and use `http://localhost:3000` consistently in the browser and `SHAREBAJAR_PUBLIC_URL`.

The Charts workspace combines an instrument price chart with a public AI news preview and two linked headlines. The `/api/news/brief` preview is shared per market for 15 minutes and rate-limited; model or configuration failures leave sourced headlines available with an explicit unavailable message. The full `/api/news` feed continues to require sign-in. AI previews use headline metadata, not full article text.
