import { SESSION_COOKIE } from "@/lib/server/auth";
import { NextResponse } from "next/server";
import { crossSiteRejection } from "@/lib/server/guard";

export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
