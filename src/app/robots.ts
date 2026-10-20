import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site/seo";
import { hiddenDeskPaths } from "@/lib/site/visibility";

export default function robots(): MetadataRoute.Robots {
  const hidden = hiddenDeskPaths();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      ...(hidden.length > 0 ? { disallow: hidden } : {}),
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
