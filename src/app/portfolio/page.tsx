import type { Metadata } from "next";
import { Portfolio } from "@/components/portfolio/Portfolio";

export const metadata: Metadata = { title: "Portfolio", robots: { index: false } };

export default function PortfolioPage() {
  return <><span data-app-page hidden /><Portfolio /></>;
}
