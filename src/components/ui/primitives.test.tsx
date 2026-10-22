import { renderToStaticMarkup } from "react-dom/server";
import { Bot } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Button, ButtonLink, EmptyState, PageHeader, SeverityBadge, StatusBadge } from ".";

describe("UI primitives", () => {
  it("render the existing button classes so adoption is visually identical", () => {
    expect(renderToStaticMarkup(<Button>Save</Button>)).toBe('<button class="btn">Save</button>');
    expect(renderToStaticMarkup(<Button variant="danger" large type="submit" disabled>Delete</Button>))
      .toBe('<button class="btn danger large" type="submit" disabled="">Delete</button>');
    expect(renderToStaticMarkup(<ButtonLink variant="primary" href="/problems">Issues</ButtonLink>))
      .toBe('<a class="btn primary" href="/problems">Issues</a>');
  });

  it("maps status meaning to the theme's badge classes", () => {
    expect(renderToStaticMarkup(<StatusBadge>Draft</StatusBadge>)).toBe('<span class="badge">Draft</span>');
    expect(renderToStaticMarkup(<StatusBadge tone="info">New</StatusBadge>)).toBe('<span class="badge brand">New</span>');
    expect(renderToStaticMarkup(<StatusBadge tone="danger">Failed</StatusBadge>)).toBe('<span class="badge critical">Failed</span>');
    expect(renderToStaticMarkup(<SeverityBadge severity="High" />)).toBe('<span class="badge high">High</span>');
  });

  it("renders one empty state with a decorative icon and optional action", () => {
    const markup = renderToStaticMarkup(<EmptyState icon={Bot} title="No runs" description="Nothing yet." action={{ href: "/problems", label: "View issues" }} />);
    expect(markup).toContain('<section class="card empty-state">');
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(markup).toContain('<a class="btn primary" href="/problems">View issues</a>');
    expect(renderToStaticMarkup(<EmptyState title="Empty" />)).not.toMatch(/<p[ >]/);
  });

  it("renders the page header with optional eyebrow and action", () => {
    expect(renderToStaticMarkup(<PageHeader eyebrow="Issue" title="Exports" action={<span>x</span>} />))
      .toBe('<div class="page-head"><div><div class="eyebrow">Issue</div><h1>Exports</h1></div><span>x</span></div>');
  });
});
