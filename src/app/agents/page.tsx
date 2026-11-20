import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentsApp } from "@/components/agents/AgentsApp";

export const metadata: Metadata = { title: "BAJAR Agents — browse, paste a link, or simply chat", description: "Shopping agents that find, compare and verify products across stores, convert prices to crypto, and check out with BAJAR Pay when the merchant supports it.", alternates: { canonical: "/agents" } };

export default function AgentsPage() {
  return <Suspense><AgentsApp /></Suspense>;
}
