import type { MetadataRoute } from "next";
import { seoPlan } from "@/lib/seo/agent";
import { absolute } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Built from the SEO agent's live plan: core pages, market lists, coins, comparisons, trending tokens. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const plan = await seoPlan();
  return plan.map((p) => ({ url: absolute(p.path), lastModified: p.lastModified, changeFrequency: p.changeFrequency, priority: p.priority }));
}
