import type { Metadata } from "next";
import {
  PUBLIC_EMAILS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

type PublicPageType = "AboutPage" | "ContactPage" | "WebPage";

export function buildTrustMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const canonical = `${SITE_URL}${path}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} customer feedback operations`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
  };
}

export function buildTrustStructuredData({
  name,
  description,
  path,
  type = "WebPage",
  breadcrumbs,
}: {
  name: string;
  description: string;
  path: string;
  type?: PublicPageType;
  breadcrumbs?: ReadonlyArray<{ name: string; path: string }>;
}) {
  const pageUrl = `${SITE_URL}${path}`;
  const crumbItems = [
    { name: "Home", path: "/" },
    ...(breadcrumbs ?? []),
    { name, path },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/closespan-title-icon-512-v3.png`,
          width: 512,
          height: 512,
        },
        description: SITE_DESCRIPTION,
        email: PUBLIC_EMAILS.hello,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: crumbItems.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: `${SITE_URL}${item.path}`,
        })),
      },
      {
        "@type": type,
        "@id": `${pageUrl}#page`,
        url: pageUrl,
        name,
        description,
        inLanguage: "en-US",
        isPartOf: {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: SITE_NAME,
          url: `${SITE_URL}/`,
        },
        about: { "@id": `${SITE_URL}/#organization` },
        breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
      },
    ],
  };
}
