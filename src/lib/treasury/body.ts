import "server-only";
import type { z } from "zod";
import { TreasuryError } from "./http";

export async function body<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const raw = await req.json().catch(() => null);
  const r = schema.safeParse(raw);
  if (!r.success) throw new TreasuryError(400, `Invalid request: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}
