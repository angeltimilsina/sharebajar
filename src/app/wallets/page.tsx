import type { Metadata } from "next";
import { WalletsHub } from "@/components/wallets/WalletsHub";

export const metadata: Metadata = { title: "Wallets", robots: { index: false } };

export default function WalletsPage() {
  return <><span data-app-page hidden /><WalletsHub /></>;
}
