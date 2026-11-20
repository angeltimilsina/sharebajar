import { NextResponse } from "next/server";
import { crossSiteRejection } from "@/lib/server/guard";
import { endSession } from "@/lib/server/gateway";

/** Signs out through the gateway: the session is revoked server-side. `?everywhere=1` ends every session of the address. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  await endSession(res, { everywhere: new URL(req.url).searchParams.get("everywhere") === "1" });
  return res;
}
