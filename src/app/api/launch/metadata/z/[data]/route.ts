import { NextResponse } from "next/server";
import { decodeCompact, toMetaplex } from "@/lib/launch/compactMetadata";

/** Serves metadata that is stored in the URL itself (immutable, no database). */
export async function GET(_req: Request, { params }: { params: Promise<{ data: string }> }) {
  const f = decodeCompact((await params).data);
  if (!f) return NextResponse.json({ error: "Invalid metadata" }, { status: 404 });
  const httpsOnly = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);
  return NextResponse.json(toMetaplex({ ...f, name: f.name.slice(0, 32), symbol: f.symbol.slice(0, 10), image: httpsOnly(f.image), website: httpsOnly(f.website), twitter: httpsOnly(f.twitter), telegram: httpsOnly(f.telegram) }), { headers: { "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
}
