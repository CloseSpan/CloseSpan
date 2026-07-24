import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { GET as getLlmsTxt } from "./llms.txt/route";
import { metadata as homeMetadata, structuredData } from "./page";
import robots from "./robots";
import sitemap from "./sitemap";
import {
  LANDING_FAQS,
  PRIVATE_APP_PATHS,
  PUBLIC_EMAILS,
  PUBLIC_DISCOVERY_PATHS,
  PUBLIC_INDEXABLE_PATHS,
  SITE_ALTERNATE_NAMES,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

describe("public search metadata", () => {
  it("uses one non-redirecting canonical identity", () => {
    expect(SITE_URL).toBe("https://www.closespan.com");
    expect(SITE_NAME).toBe("CloseSpan");
    expect(SITE_ALTERNATE_NAMES).toContain("closespan.com");
    expect(homeMetadata.title).toEqual({ absolute: SITE_TITLE });
    expect(homeMetadata.description).toBe(SITE_DESCRIPTION);
    expect(homeMetadata.alternates).toEqual({ canonical: "/" });
    expect(PUBLIC_EMAILS).toEqual({
      hello: "hello@closespan.com",
      support: "support@closespan.com",
      security: "security@closespan.com",
      privacy: "privacy@closespan.com",
    });
    expect(sitemap()).toEqual(
      PUBLIC_INDEXABLE_PATHS.map((path) => ({
        url: path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`,
      })),
    );
    expect(sitemap().every((entry) => entry.lastModified === undefined)).toBe(
      true,
    );
  });

  it("allows search crawlers to reach public content while excluding app data", () => {
    const output = robots();
    const rules = Array.isArray(output.rules) ? output.rules : [output.rules];
    const userAgents = rules.map((rule) => rule.userAgent);

    expect(userAgents).toEqual(
      expect.arrayContaining([
        "*",
        "OAI-SearchBot",
        "ChatGPT-User",
        "Claude-SearchBot",
        "Claude-User",
      ]),
    );
    for (const rule of rules) {
      expect(rule.allow).toEqual(
        expect.arrayContaining([
          "/",
          "/integrations/zendesk",
          "/integrations/intercom",
          "/integrations/github",
        ]),
      );
      expect(rule.disallow).toEqual([...PRIVATE_APP_PATHS]);
    }
    expect(output.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(PUBLIC_DISCOVERY_PATHS).toEqual(
      expect.arrayContaining([
        "/robots.txt",
        "/sitemap.xml",
        "/manifest.webmanifest",
        "/llms.txt",
        "/opengraph-image",
        "/requests",
        "/resources",
        "/connectors",
        "/integrations/zendesk",
      ]),
    );
  });

  it("publishes factual website, organization, application, and FAQ schema", () => {
    const graph = structuredData["@graph"];

    const websiteNode = graph.find((node) => node["@type"] === "WebSite");
    expect(websiteNode).toMatchObject({
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: `${SITE_URL}/`,
    });
    const organizationNode = graph.find(
      (node) => node["@type"] === "Organization",
    );
    expect(organizationNode).toMatchObject({
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: `${SITE_URL}/`,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon-512.png`,
        contentUrl: `${SITE_URL}/favicon-512.png`,
        width: 512,
        height: 512,
      },
    });
    expect(organizationNode).not.toHaveProperty("sameAs");
    expect(
      graph.some(
        (node) =>
          Array.isArray(node["@type"]) &&
          node["@type"].includes("WebApplication"),
      ),
    ).toBe(true);
    const faqNode = graph.find((node) => node["@type"] === "FAQPage");
    if (!faqNode || !("mainEntity" in faqNode)) {
      throw new Error("FAQPage schema is missing its visible questions");
    }
    expect(faqNode.mainEntity).toHaveLength(LANDING_FAQS.length);
  });

  it("provides app identity and a crawlable product brief", async () => {
    const appManifest = manifest();
    expect(appManifest.name).toContain(SITE_NAME);
    expect(appManifest.short_name).toBe(SITE_NAME);
    expect(appManifest.start_url).toBe("/");
    expect(appManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/favicon-192.png",
          sizes: "192x192",
          type: "image/png",
        }),
        expect.objectContaining({
          src: "/favicon-512.png",
          sizes: "512x512",
          type: "image/png",
        }),
      ]),
    );

    const response = getLlmsTxt();
    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain(`# ${SITE_NAME}`);
    expect(body).toContain(`${SITE_URL}/`);
    expect(body).toContain(`Preferred product name: ${SITE_NAME}`);
    expect(body).toContain("feedback-to-fix");
    expect(body).toContain(`${SITE_URL}/resources`);
    expect(body).toContain(`${SITE_URL}/connectors`);
    expect(body).toContain(`${SITE_URL}/integrations/zendesk`);
    for (const { question } of LANDING_FAQS) {
      expect(body).toContain(question);
    }
  });
});
