import type { Metadata } from "next";
import { ConnectToBajar } from "@/components/bajar/ConnectToBajar";

export const metadata: Metadata = { title: "Connect to Bajar Wallet", robots: { index: false } };

export default async function ConnectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <><span data-app-page hidden /><ConnectToBajar token={token} /></>;
}
