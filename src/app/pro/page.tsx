import type { Metadata } from "next";
import { ProPage } from "@/components/pro/ProPage";

export const metadata: Metadata = {
  title: "Bajar Pro — one profile for all your wallets",
  description: "Link up to 25 wallets to one verified profile and get an advanced investment agent with live portfolio reads, risk reports and trade plans you approve yourself.",
  alternates: { canonical: "/pro" },
};

export default function Pro() {
  return <ProPage />;
}
