import type { Metadata } from "next";
import { OrdersPage } from "@/components/agents/OrdersPage";

export const metadata: Metadata = { title: "Your orders — BAJAR Agents", robots: { index: false } };

export default function Page() { return <OrdersPage />; }
