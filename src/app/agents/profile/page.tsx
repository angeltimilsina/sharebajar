import type { Metadata } from "next";
import { Suspense } from "react";
import { ShoppingProfile } from "@/components/agents/ShoppingProfile";

export const metadata: Metadata = { title: "Shopping profile — BAJAR Agents", robots: { index: false } };

export default function Page() { return <Suspense><ShoppingProfile /></Suspense>; }
