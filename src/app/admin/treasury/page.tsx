import type { Metadata } from "next";
import { Suspense } from "react";
import { TreasuryApp } from "@/components/treasury/TreasuryApp";

export const metadata: Metadata = { title: "Treasury", robots: { index: false, follow: false } };

export default function TreasuryPage() {
  return <Suspense><TreasuryApp /></Suspense>;
}
