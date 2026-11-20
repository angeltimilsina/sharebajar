import { getMarkets } from "@/lib/market/markets";
import { formatPrice, formatUsd } from "@/lib/format";
import { OG_SIZE, ogCard } from "@/components/seo/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Live price card";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = /^[a-z0-9-]{1,80}$/.test(id) ? await getMarkets({ ids: [id] }).then((r) => r.data[0]).catch(() => undefined) : undefined;
  if (!c) return ogCard({ eyebrow: "Markets", title: "Live crypto prices", rows: [] });
  return ogCard({
    eyebrow: `${c.symbol} price`,
    title: `${c.name} price today`,
    rows: [
      { label: "Price", value: formatPrice(c.price), change: c.change24h },
      { label: "Market cap", value: formatUsd(c.marketCap) },
      { label: "24h volume", value: formatUsd(c.volume24h) },
    ],
  });
}
