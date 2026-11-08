import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const binanceWs = process.env.NEXT_PUBLIC_BINANCE_WS_URL || "wss://data-stream.binance.vision";

// Baseline for every page: no framing (clickjacking), no plugins, no <base>/form hijacking.
const baseCsp = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

/**
 * Wallet pages: the browser may only talk to Bajar's own API (plus the live
 * price stream). Even if a script were injected, it could not send keys or
 * phrases to another host. Next.js needs inline bootstrap scripts; dev mode
 * additionally needs eval for fast refresh.
 */
const walletCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${binanceWs}${isDev ? " ws: http://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  baseCsp,
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: baseCsp },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Charts live inside the Trade workspace now; query (symbol/chain/token) is preserved.
  async redirects() {
    return [{ source: "/charts", destination: "/trade", permanent: false }];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/wallet/:path*",
        headers: [
          { key: "Content-Security-Policy", value: walletCsp },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      { source: "/wallet", headers: [{ key: "Content-Security-Policy", value: walletCsp }, { key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/api/(auth|wallet)/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
