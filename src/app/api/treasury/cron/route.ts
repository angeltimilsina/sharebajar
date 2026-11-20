import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runIndexer } from "@/lib/treasury/engine";

export const maxDuration = 300;

/** Scheduled indexing (Vercel Cron sends Authorization: Bearer $CRON_SECRET). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ summary: await runIndexer({ actor: "system:cron" }) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
