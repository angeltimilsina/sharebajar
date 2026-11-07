"use client";
import Link from "next/link";
import { useLiveTickers, useStreamStatus } from "@/hooks/useBinance";
import { useNow } from "@/hooks/useNow";
import { binanceStream } from "@/lib/stream/binance-ws";
import { formatPrice, formatPct, pctClass } from "@/lib/format";
import { TokenIcon } from "../ui/TokenIcon";

const IMG = "https://coin-images.coingecko.com/coins/images";
export const TICKER = [
  { s: "BTC", id: "bitcoin", img: `${IMG}/1/small/bitcoin.png` },
  { s: "ETH", id: "ethereum", img: `${IMG}/279/small/ethereum.png` },
  { s: "SOL", id: "solana", img: `${IMG}/4128/small/solana.png` },
  { s: "BNB", id: "binancecoin", img: `${IMG}/825/small/bnb-icon2_2x.png` },
  { s: "XRP", id: "ripple", img: `${IMG}/44/small/xrp-symbol-white-128.png` },
  { s: "DOGE", id: "dogecoin", img: `${IMG}/5/small/dogecoin.png` },
  { s: "ADA", id: "cardano", img: `${IMG}/975/small/cardano.png` },
  { s: "AVAX", id: "avalanche-2", img: `${IMG}/12559/small/Avalanche_Circle_RedWhite_Trans.png` },
  { s: "LINK", id: "chainlink", img: `${IMG}/877/small/chainlink-new-logo.png` },
  { s: "TRX", id: "tron", img: `${IMG}/1094/small/tron-logo.png` },
  { s: "SUI", id: "sui", img: null },
  { s: "PEPE", id: "pepe", img: null },
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
