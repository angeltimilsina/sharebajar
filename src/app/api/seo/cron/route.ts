import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { seoPlan } from "@/lib/seo/agent";
import { submitIndexNow } from "@/lib/seo/indexnow";

export const maxDuration = 60;

/**
 * Daily SEO run (Vercel Cron sends Authorization: Bearer $CRON_SECRET):
 * rebuild the page plan from live data and push it to IndexNow.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const plan = await seoPlan();
    const indexnow = await submitIndexNow(plan.map((p) => p.path));
    return NextResponse.json({ pages: plan.length, indexnow });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
