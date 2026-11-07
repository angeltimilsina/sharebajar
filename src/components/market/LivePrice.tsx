"use client";
import { useLiveTickers } from "@/hooks/useBinance";
import { Pct } from "../ui/primitives";
import { PriceCell } from "./PriceCell";
import { DataStatus } from "../ui/DataStatus";

export function LivePrice({ symbol, fallback, fallbackChange, fetchedAt }: { symbol: string | null; fallback: number | null; fallbackChange: number | null; fetchedAt: number }) {
  const live = useLiveTickers(symbol ? [symbol] : []);
  const t = symbol ? live[symbol] : undefined;
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <PriceCell value={t?.price ?? fallback} live={!!t} className="text-3xl font-bold tracking-tight" />
        <Pct v={t?.change24h ?? fallbackChange} className="text-sm font-semibold" />
      </div>
      <DataStatus fetchedAt={t?.updatedAt ?? fetchedAt} expectedMs={t ? 3000 : 90_000} source={t ? "Binance stream" : "CoinGecko"} />
    </div>
  );
}
