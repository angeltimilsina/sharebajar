import { NextResponse } from "next/server";
import { readSession, renewIfDue } from "@/lib/server/gateway";
import { secureCookies } from "@/lib/server/guard";

/** The current verified session (from the auth gateway), renewed while used. */
export async function GET(req: Request) {
  const s = await readSession();
  const res = NextResponse.json({ session: null }, { headers: { "cache-control": "no-store" } });
  if (!s) { if (req.headers.get("cookie")?.includes("sb_session=")) res.cookies.delete("sb_session"); return res; }
  const cur = await renewIfDue(res, secureCookies(req), s);
  const { sid: _sid, ...pub } = cur;
  void _sid;
  return NextResponse.json({ session: pub }, { headers: res.headers });
}
