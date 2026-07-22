import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { GET as getLlmsTxt } from "./llms.txt/route";
import { metadata as homeMetadata, structuredData } from "./page";
import robots from "./robots";
import sitemap from "./sitemap";
import {
  LANDING_FAQS,
  PRIVATE_APP_PATHS,
  PUBLIC_DISCOVERY_PATHS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

describe("public search metadata", () => {
  it("uses one non-redirecting canonical identity", () => {
    expect(SITE_URL).toBe("https://www.closespan.com");
    expect(homeMetadata.title).toEqual({ absolute: SITE_TITLE });
    expect(homeMetadata.description).toBe(SITE_DESCRIPTION);
    expect(homeMetadata.alternates).toEqual({ canonical: "/" });
    expect(sitemap()).toEqual([
      { url: `${SITE_URL}/` },
      { url: `${SITE_URL}/requests` },
    ]);
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
      expect(rule.allow).toBe("/");
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
      ]),
    );
  });

  it("publishes factual website, organization, application, and FAQ schema", () => {
    const graph = structuredData["@graph"];

    expect(graph.some((node) => node["@type"] === "WebSite")).toBe(true);
    expect(graph.some((node) => node["@type"] === "Organization")).toBe(true);
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
    expect(appManifest.start_url).toBe("/");

    const response = getLlmsTxt();
    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain(`# ${SITE_NAME}`);
    expect(body).toContain(`${SITE_URL}/`);
    expect(body).toContain("feedback-to-fix");
    for (const { question } of LANDING_FAQS) {
      expect(body).toContain(question);
    }
  });
});
