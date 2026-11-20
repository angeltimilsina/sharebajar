import { AI_MODEL, aiConfigured } from "@/lib/ai/config";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ configured: aiConfigured(), model: aiConfigured() ? AI_MODEL : null });
}
