import { siteUrl } from "@/lib/site";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { TickerBar } from "@/components/layout/TickerBar";
import { Footer } from "@/components/layout/Footer";
import { THEME_SCRIPT } from "@/components/layout/ThemeToggle";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { ApprovalHost } from "@/components/bajar/ApprovalHost";
import { WalletModal } from "@/components/wallet/WalletModal";
import { AlertWatcher } from "@/components/layout/AlertWatcher";
import { Toaster } from "@/components/layout/Toaster";
import { MobileNav } from "@/components/layout/MobileNav";

const SITE = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Bajar — The Open Crypto Marketplace", template: "%s · Bajar" },
  description: "Discover tokens, analyze real-time markets and trade across Solana, Ethereum, Base, BNB Chain, Polygon and Arbitrum — all in one place.",
  applicationName: "Bajar",
  keywords: ["crypto", "marketplace", "token discovery", "solana", "dex", "charts", "swap", "crypto prices"],
  openGraph: { type: "website", siteName: "Bajar", title: "Bajar — The Open Crypto Marketplace", description: "Real-time multi-chain crypto market data, pro charts, wallet trading and AI market intelligence." },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Bajar", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#1f1e1d",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
          { "@context": "https://schema.org", "@type": "WebSite", name: "Bajar", url: SITE },
          { "@context": "https://schema.org", "@type": "Organization", name: "Bajar", url: SITE, logo: `${SITE}/icon.svg` },
        ]) }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <WalletProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] btn-silver px-3 py-2 rounded-lg">Skip to content</a>
          <Header />
          <TickerBar />
          <main id="main" className="flex-1 w-full mx-auto max-w-[1680px] px-3 sm:px-4 lg:px-6 py-4 lg:py-5">{children}</main>
          <Footer />
          <MobileNav />
          <WalletModal />
          <AlertWatcher />
          <Toaster />
          <ApprovalHost />
        </WalletProvider>
      </body>
    </html>
  );
}
