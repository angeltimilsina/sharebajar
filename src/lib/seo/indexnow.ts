import "server-only";
import { fetchUpstream } from "../server/http";
import { absolute, siteUrl } from "../site";

/**
 * Submit URLs to IndexNow (shared by Bing, Yandex, Seznam, Naver…).
 * Google doesn't use IndexNow; it reads the sitemap.
 */
export async function submitIndexNow(paths: string[]): Promise<{ submitted: number; status: string }> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) return { submitted: 0, status: "skipped: INDEXNOW_KEY not set" };
  const site = siteUrl();
  if (site.startsWith("http://localhost")) return { submitted: 0, status: "skipped: no public site URL" };
  const urlList = [...new Set(paths)].slice(0, 10_000).map(absolute);
  await fetchUpstream("https://api.indexnow.org/indexnow", {
    method: "POST",
    body: { host: new URL(site).host, key, keyLocation: absolute("/indexnow.txt"), urlList },
    timeoutMs: 20_000, retries: 1, text: true,
  });
  return { submitted: urlList.length, status: "ok" };
}
