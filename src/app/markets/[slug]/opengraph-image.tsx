import { topicBySlug } from "@/lib/seo/topics";
import { OG_SIZE, ogCard } from "@/components/seo/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Crypto market list";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const t = topicBySlug((await params).slug);
  return ogCard({ eyebrow: "Markets", title: t?.title ?? "Crypto markets", rows: [{ label: "Updated", value: "Live, every few minutes" }] });
}
