"use client";
import { Button } from "@/components/ui/primitives";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted max-w-md mx-auto">{error.message || "An unexpected error occurred while loading this page."}</p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </div>
  );
}
