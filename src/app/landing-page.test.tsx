import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING_FAQS } from "@/lib/site";
import LandingPage from "./page";

function renderLanding() {
  const html = renderToStaticMarkup(<LandingPage />);
  const visibleHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const links = Array.from(
    visibleHtml.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
    ([, href, content]) => ({
      href,
      label: content.replace(/<[^>]+>/g, "").trim(),
    }),
  );
  return { html, visibleHtml, links };
}

describe("customer-success landing page", () => {
  it("routes workspace entry through sign-in and keeps direct sign-in available", () => {
    const { visibleHtml, links } = renderLanding();
    const startLinks = links.filter(({ label }) => label === "Get started");
    expect(startLinks).toHaveLength(3);
    expect(startLinks.every(({ href }) => href === "/login?callbackUrl=%2Foverview")).toBe(true);

    const signInLinks = links.filter(({ label }) => label === "Sign in");
    expect(signInLinks.length).toBeGreaterThan(0);
    expect(signInLinks.every(({ href }) => href === "/login")).toBe(true);
    expect(visibleHtml).toContain("Human approval by default.");
    expect(links).toContainEqual({ href: "/contact", label: "Contact" });
  });

  it("keeps public navigation separate from authenticated workspace entry", () => {
    const { links } = renderLanding();
    for (const { href } of links) {
      expect(href).not.toMatch(/^\/(?:overview|waitlist|calls|components)(?:[/?#]|$)/);
      if (href.includes("callbackUrl")) {
        expect(href).toBe("/login?callbackUrl=%2Foverview");
      }
    }
    expect(links).toContainEqual({ href: "/requests", label: "Requests" });
  });

  it("preserves crawlable section anchors and skip navigation", () => {
    const { visibleHtml, links } = renderLanding();
    const ids = new Set(Array.from(visibleHtml.matchAll(/\bid="([^"]+)"/g), ([, id]) => id));
    for (const id of ["landing-content", "product", "workflow", "trust", "faq"]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(links).toContainEqual({ href: "#landing-content", label: "Skip to content" });
    for (const { href } of links.filter(({ href }) => href.startsWith("#"))) {
      expect(ids.has(href.slice(1))).toBe(true);
    }
    expect(visibleHtml.match(/<h1\b/g)).toHaveLength(1);
  });

  it("renders the same FAQ questions and answers that it publishes in structured data", () => {
    const { html, visibleHtml } = renderLanding();
    const faqHtml = visibleHtml.match(/<section\b[^>]*id="faq"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(faqHtml).toBeDefined();
    expect(faqHtml?.match(/<article\b/g)).toHaveLength(LANDING_FAQS.length);
    for (const { question, answer } of LANDING_FAQS) {
      expect(faqHtml).toContain(renderToStaticMarkup(<h3>{question}</h3>));
      expect(faqHtml).toContain(renderToStaticMarkup(<p>{answer}</p>));
    }

    const json = html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(json).toBeDefined();
    const data = JSON.parse(json!) as { "@graph": Array<{ "@type": string | string[]; mainEntity?: unknown }> };
    const faqSchema = data["@graph"].find((node) => node["@type"] === "FAQPage");
    expect(faqSchema?.mainEntity).toEqual(LANDING_FAQS.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })));
  });

  it("labels mock product views and keeps preview confirmation distinct from production", () => {
    const { visibleHtml } = renderLanding();
    expect(visibleHtml).toContain("Illustrative workspace · Sample problems and data");
    expect(visibleHtml).toContain('aria-label="Illustrative CloseSpan workspace"');
    expect(visibleHtml).toContain("Example workspace");
    expect(visibleHtml).toContain('aria-label="Illustrative approval request"');
    expect(visibleHtml).toContain("Illustrative approval. No action will be taken.");
    expect(visibleHtml).toContain("reviewing it does not authorize a merge or deployment.");
    expect(visibleHtml).not.toMatch(/<button\b[^>]*>[\s\S]*?Approve action/);
  });

  it("server-renders the four workflow steps in order", () => {
    const { visibleHtml } = renderLanding();
    const workflowHtml = visibleHtml.match(/<section\b[^>]*id="workflow"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(workflowHtml).toBeDefined();
    const steps = Array.from(
      workflowHtml!.matchAll(/<li\b[^>]*>[\s\S]*?<h3>([^<]+)<\/h3>[\s\S]*?<\/li>/g),
      ([, title]) => title,
    );
    expect(steps).toEqual([
      "Connect your sources", "Let the agent investigate", "Test and approve", "Close the loop",
    ]);
    expect(workflowHtml).toContain("Keep meaningful external actions under your control.");
  });

  it("starts with customer evidence rather than a falsely confirmed test result", () => {
    const { visibleHtml } = renderLanding();
    const selectedProblem = visibleHtml.match(/<aside\b[^>]*aria-label="Sample selected problem"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
    expect(selectedProblem).toBeDefined();
    expect(selectedProblem).toContain("Needs review");
    expect(selectedProblem).toContain("Large CSV exports produce empty files");
    expect(selectedProblem).toContain("3 corroborating reports after release 4.18.2.");
    expect(selectedProblem).toContain("Evidence grouped. Ready for investigation and prompt preparation.");
    expect(selectedProblem).not.toMatch(/Tests passed|Verified fix|Deployed to production/);
  });
});
