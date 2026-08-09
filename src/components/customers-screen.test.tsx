import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomerView } from "@/lib/workspace-repository";
import { CustomersScreen } from "./screens";

describe("CustomersScreen", () => {
  it("shows imported account provenance without inventing ARR or tenure", () => {
    const customer: CustomerView = {
      id: "account-zendesk-1",
      name: "Northwind",
      tier: "Unknown",
      arr: 0,
      arrSource: "unknown",
      customerSince: 0,
      customerSinceKnown: false,
      signals: 4,
      openProblems: 1,
      churnRisk: "Unknown",
      origin: "integration",
      sourceNames: ["Zendesk"],
    };

    const markup = renderToStaticMarkup(
      <CustomersScreen customers={[customer]} />,
    );

    expect(markup).toContain("Customer since not available");
    expect(markup).toContain("Imported from Zendesk");
    expect(markup).toContain("Not available");
    expect(markup).not.toContain("$0");
  });

  it("labels seeded accounts as demo data", () => {
    const customer: CustomerView = {
      id: "acct_demo_northwind",
      name: "Northwind",
      tier: "Enterprise",
      arr: 125000,
      arrSource: "demo",
      customerSince: 2023,
      customerSinceKnown: true,
      signals: 2,
      openProblems: 1,
      churnRisk: "Low",
      origin: "demo",
      sourceNames: [],
    };

    const markup = renderToStaticMarkup(
      <CustomersScreen customers={[customer]} />,
    );

    expect(markup).toContain("Customer since 2023 · Demo account");
    expect(markup).toContain("$125k");
  });
});
