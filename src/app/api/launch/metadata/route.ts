import { NextResponse } from "next/server";
import { z } from "zod";
import { q, newId } from "@/lib/treasury/db";
import { crossSiteRejection, requestHost } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const httpsUrl = z.string().url().max(300).refine((u) => /^https:\/\//.test(u), "Must be an https URL");
const Body = z.object({
  name: z.string().trim().min(1).max(32), symbol: z.string().regex(/^[A-Za-z0-9$._-]{1,10}$/),
  description: z.string().max(1000).optional().default(""),
  image: httpsUrl.optional(), website: httpsUrl.optional(), twitter: httpsUrl.optional(), telegram: httpsUrl.optional(),
});

/**
 * Hosts token metadata JSON (Metaplex fungible standard) at a short, permanent
 * URL so creators don't need their own storage. Content is public and
 * immutable once created (new edits get a new id).
 */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`meta:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Invalid metadata" }, { status: 400 });
  const d = p.data;
  const json = {
    name: d.name, symbol: d.symbol, description: d.description, ...(d.image ? { image: d.image } : {}),
    extensions: { ...(d.website ? { website: d.website } : {}), ...(d.twitter ? { twitter: d.twitter } : {}), ...(d.telegram ? { telegram: d.telegram } : {}) },
    ...(d.image ? { properties: { files: [{ uri: d.image, type: "image/png" }], category: "image" } } : {}),
  };
  try {
    const id = newId("tm").slice(3, 19);
    await q("insert into token_metadata (id, json) values ($1, $2)", [id, JSON.stringify(json)]);
    const proto = new URL(req.url).protocol === "http:" && /^localhost|^127\./.test(requestHost(req)) ? "http" : "https";
    return NextResponse.json({ uri: `${proto}://${requestHost(req)}/api/launch/metadata/${id}`, json });
  } catch (e) {
    return NextResponse.json({ error: "Metadata hosting is unavailable on this deployment (no database). Provide your own metadata URI (IPFS/Arweave).", detail: String(e).slice(0, 120) }, { status: 503 });
  }
}
