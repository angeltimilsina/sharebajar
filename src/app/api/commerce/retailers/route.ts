import { NextResponse } from "next/server";
import { retailers } from "@/lib/commerce/registry";
import { realProvider } from "@/lib/commerce/orders";

/** What Bajar can do with each retailer right now. */
export async function GET() {
  return NextResponse.json({ retailers: retailers().map(({ id, name, capabilities, checkout, note }) => ({ id, name, capabilities, checkout, note })), livePayments: !!realProvider() });
}
