import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <div className="text-6xl font-bold text-brand">404</div>
      <h1 className="mt-3 text-xl font-semibold">This market doesn&apos;t exist</h1>
      <p className="mt-1 text-sm text-muted">The token or page you&apos;re looking for couldn&apos;t be found.</p>
      <Link href="/" className="inline-block mt-6"><Button>Back to markets</Button></Link>
    </div>
  );
}
