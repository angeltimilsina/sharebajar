import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/api/openapi";
import { siteUrl } from "@/lib/site";

export function GET() {
  return NextResponse.json(openApiSpec(siteUrl()), { headers: { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=3600" } });
}
