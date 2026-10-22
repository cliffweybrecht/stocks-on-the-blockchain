import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/site/seo";
import { publicSitemapPaths } from "@/lib/site/visibility";

export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return publicSitemapPaths().map((path) => ({
    url: canonicalUrl(path),
    lastModified,
    changeFrequency: "daily",
    priority: path === "/" ? 1 : 0.7,
  }));
}
