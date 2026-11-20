import type { MetadataRoute } from "next";
import { absolute, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/portfolio", "/admin", "/wallet"] }],
    sitemap: absolute("/sitemap.xml"),
    host: siteUrl(),
  };
}
