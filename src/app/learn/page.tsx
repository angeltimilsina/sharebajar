import type { Metadata } from "next";
import { LearnPage } from "@/components/learn/LearnPage";

export const metadata: Metadata = {
  title: "Learn — crypto lessons and a student sandbox",
  description: "Short lessons on wallets, token launches, liquidity and scams, with a free Solana devnet sandbox to practise launching and managing tokens using test coins.",
  alternates: { canonical: "/learn" },
};

export default function Learn() {
  return <LearnPage />;
}
