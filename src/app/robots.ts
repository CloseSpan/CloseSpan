import type { MetadataRoute } from "next";
import { PRIVATE_APP_PATHS, SITE_URL } from "@/lib/site";

const privatePaths = [...PRIVATE_APP_PATHS];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
      {
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: privatePaths,
      },
      {
        userAgent: "ChatGPT-User",
        allow: "/",
        disallow: privatePaths,
      },
      {
        userAgent: "Claude-SearchBot",
        allow: "/",
        disallow: privatePaths,
      },
      {
        userAgent: "Claude-User",
        allow: "/",
        disallow: privatePaths,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
