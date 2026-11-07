import { getNews } from "@/lib/news/feeds";
import { filterNews } from "@/lib/news/rss";
import { fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const env = await getNews();
    const q = url.searchParams.get("q");
    const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20);
    const data = q ? filterNews(env.data, q.split(",").slice(0, 4)) : env.data;
    return ok({ ...env, data: data.slice(0, limit) }, 120);
  } catch (e) {
    return fail(e, "News");
  }
}
