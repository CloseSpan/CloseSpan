import type { MetadataRoute } from "next";
import {
  PRIVATE_APP_PATHS,
  PUBLIC_INDEXABLE_PATHS,
  SITE_URL,
} from "@/lib/site";

const privatePaths = [...PRIVATE_APP_PATHS];
const publicPathsWithinPrivatePrefixes = PUBLIC_INDEXABLE_PATHS.filter((path) =>
  PRIVATE_APP_PATHS.some(
    (privatePath) =>
      !privatePath.endsWith("/") && path.startsWith(`${privatePath}/`),
  ),
);
const allowedPaths = ["/", ...publicPathsWithinPrivatePrefixes];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: allowedPaths,
        disallow: privatePaths,
      },
      {
        userAgent: "OAI-SearchBot",
        allow: allowedPaths,
        disallow: privatePaths,
      },
      {
        userAgent: "ChatGPT-User",
        allow: allowedPaths,
        disallow: privatePaths,
      },
      {
        userAgent: "Claude-SearchBot",
        allow: allowedPaths,
        disallow: privatePaths,
      },
      {
        userAgent: "Claude-User",
        allow: allowedPaths,
        disallow: privatePaths,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
