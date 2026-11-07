import type { MetadataRoute } from "next";
import { getMarkets } from "@/lib/market/coingecko";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const pages = ["", "/discover", "/trade", "/charts", "/launchpad", "/intelligence"].map((p) => ({ url: `${site}${p}`, changeFrequency: "hourly" as const, priority: p ? 0.8 : 1 }));
  try {
    const { data } = await getMarkets({ perPage: 200 });
    return [...pages, ...data.map((c) => ({ url: `${site}/coin/${c.id}`, changeFrequency: "hourly" as const, priority: 0.6 }))];
  } catch {
    return pages;
  }
}
