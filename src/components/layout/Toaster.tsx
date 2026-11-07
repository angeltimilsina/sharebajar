"use client";
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

export function Toaster() {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text: String((e as CustomEvent).detail) }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    };
    window.addEventListener("sb-toast", on);
    return () => window.removeEventListener("sb-toast", on);
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[120] space-y-2 max-w-sm" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="panel glass px-4 py-3 text-sm flex items-start gap-2"><BellRing size={16} className="text-brand mt-0.5 shrink-0" />{t.text}</div>
      ))}
    </div>
  );
}

export const toast = (text: string) => window.dispatchEvent(new CustomEvent("sb-toast", { detail: text }));
