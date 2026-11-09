import { NextResponse } from "next/server";
import { z } from "zod";
import { q, newId } from "@/lib/treasury/db";
import { crossSiteRejection, requestHost } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { encodeCompact, toMetaplex } from "@/lib/launch/compactMetadata";
import { log } from "@/lib/server/log";

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
  const json = toMetaplex(d);
  const proto = new URL(req.url).protocol === "http:" && /^localhost|^127\./.test(requestHost(req)) ? "http" : "https";
  const base = `${proto}://${requestHost(req)}`;
  try {
    const id = newId("tm").slice(3, 19);
    await q("insert into token_metadata (id, json) values ($1, $2)", [id, JSON.stringify(json)]);
    return NextResponse.json({ uri: `${base}/api/launch/metadata/${id}`, json });
  } catch (e) {
    log("warn", "metadata hosting: database unavailable, using in-URL metadata", { error: String(e).slice(0, 160) });
    // No database: put the (compressed) metadata in the URL itself.
    const c = encodeCompact(d, base);
    if (c) return NextResponse.json({ uri: c.uri, json: toMetaplex({ ...d, ...Object.fromEntries(c.dropped.map((k) => [k, undefined])) }), dropped: c.dropped, mode: "in-url" });
    return NextResponse.json({ error: "The logo link is too long to store without hosting. Use a shorter image URL, or your own metadata URI (IPFS/Arweave) under Advanced." }, { status: 503 });
  }
}
