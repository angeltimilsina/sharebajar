"use client";
import Link from "next/link";
import { useLiveTickers, useStreamStatus } from "@/hooks/useBinance";
import { useNow } from "@/hooks/useNow";
import { binanceStream } from "@/lib/stream/binance-ws";
import { formatPrice, formatPct, pctClass } from "@/lib/format";
import { TokenIcon } from "../ui/TokenIcon";

const icon = (s: string) => `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${s.toLowerCase()}.png`;
const T = (s: string, id: string) => ({ s, id, img: icon(s) });
/** Majors streamed live from Binance; ids are Bajar coin slugs (/coin/[id]). */
export const TICKER = [
  T("BTC", "bitcoin"), T("ETH", "ethereum"), T("SOL", "solana"), T("BNB", "binance-coin"), T("XRP", "ripple"), T("DOGE", "dogecoin"),
  T("ADA", "cardano"), T("AVAX", "avalanche"), T("LINK", "chainlink"), T("TRX", "tron"), T("SUI", "sui"), T("TON", "toncoin"),
];

export function TickerBar() {
  const live = useLiveTickers(TICKER.map((t) => `${t.s}USDT`));
  const status = useStreamStatus();
  const now = useNow(1000);
  // "Live" only when the WebSocket is actually delivering messages.
  const isLive = !!now && status === "open" && now - binanceStream().lastMessage < 15_000;
  const items = TICKER.map((t) => ({ ...t, d: live[`${t.s}USDT`] }));
  const row = (dup: boolean) =>
    items.map((t) => (
      <Link key={`${t.s}${dup ? "-d" : ""}`} href={`/coin/${t.id}`} aria-hidden={dup || undefined} tabIndex={dup ? -1 : undefined} className="flex items-center gap-1.5 shrink-0 px-4 text-[13px] hover:opacity-80">
        <TokenIcon src={t.img} symbol={t.s} size={16} />
        <span className="font-semibold">{t.s}</span>
        <span className="num">{t.d ? formatPrice(t.d.price) : "—"}</span>
        <span className={`num ${pctClass(t.d?.change24h)}`}>{t.d ? formatPct(t.d.change24h) : ""}</span>
      </Link>
    ));
  return (
    <div className="border-b border-line bg-bg-elev">
      <div className="mx-auto max-w-[1680px] h-10 flex items-center gap-3 px-4 lg:px-6">
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${isLive ? "bg-up/12 text-up" : status === "reconnecting" ? "bg-warn/12 text-warn" : "bg-surface-3 text-muted"}`}
          title={isLive ? "Streaming from Binance market data" : status === "reconnecting" ? "Reconnecting to price stream…" : "Connecting to price stream"}
        >
          <span className={`h-2 w-2 rounded-full ${isLive ? "bg-up pulse-dot" : status === "reconnecting" ? "bg-warn" : "bg-faint"}`} />
          {isLive ? "Live" : status === "reconnecting" ? "Reconnecting" : "Connecting"}
        </span>
        <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_3%,black_97%,transparent)]">
          <div className="flex w-max marquee">{row(false)}{row(true)}</div>
        </div>
        <span className="hidden xl:inline shrink-0 text-[12px] text-muted num" suppressHydrationWarning>
          Market: <span className="text-up">Open 24/7</span> | {now ? new Date(now).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : ""}
        </span>
      </div>
    </div>
  );
}
