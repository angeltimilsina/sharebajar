import { SESSION_COOKIE, unseal, type Session } from "@/lib/server/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const session = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value);
  return NextResponse.json({ session }, { headers: { "cache-control": "no-store" } });
}
