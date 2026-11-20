import type { Metadata } from "next";
import { StatusView } from "@/components/portfolio/StatusView";

export const metadata: Metadata = { title: "System status" };

export default function StatusPage() {
  return <StatusView />;
}
