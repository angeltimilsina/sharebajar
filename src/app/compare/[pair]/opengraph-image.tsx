import { getMarkets } from "@/lib/market/markets";
import { parsePair } from "@/lib/seo/topics";
import { formatPrice } from "@/lib/format";
import { OG_SIZE, ogCard } from "@/components/seo/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Coin comparison card";

export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const ids = parsePair((await params).pair);
  const data = ids ? await getMarkets({ ids }).then((r) => r.data).catch(() => []) : [];
  const [a, b] = (ids ?? []).map((id) => data.find((c) => c.id === id));
  if (!a || !b) return ogCard({ eyebrow: "Compare", title: "Compare cryptocurrencies", rows: [] });
  return ogCard({
    eyebrow: "Compare",
    title: `${a.name} vs ${b.name}`,
    rows: [
      { label: a.symbol, value: formatPrice(a.price), change: a.change24h },
      { label: b.symbol, value: formatPrice(b.price), change: b.change24h },
    ],
  });
}
