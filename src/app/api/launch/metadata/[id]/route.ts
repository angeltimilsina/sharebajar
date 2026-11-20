import { NextResponse } from "next/server";
import { q } from "@/lib/treasury/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{8,24}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const [r] = await q<{ json: string }>("select json from token_metadata where id = $1", [id]);
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(r.json, { headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
