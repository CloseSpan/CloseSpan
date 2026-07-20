import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrightDataPublicFeedbackDiscoveryAdapter,
  buildPublicFeedbackSearchQuery,
  createPublicFeedbackDiscoveryAdapters,
  discoverPublicFeedbackSources,
  publicFeedbackDiscoveryConfiguration,
  type PublicFeedbackDiscoveryAdapter,
  type PublicFeedbackDiscoveryInput,
  YouPublicFeedbackDiscoveryAdapter,
} from "./public-feedback-discovery";

const product: PublicFeedbackDiscoveryInput = {
  productName: "Acme",
  productUrl: "https://acme.example",
  productDescription: "A private product description that should not be searched",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public feedback discovery configuration", () => {
  it("keeps You.com and Bright Data disabled by default", async () => {
    expect(publicFeedbackDiscoveryConfiguration({})).toEqual({
      you: { enabled: false, configured: false },
      brightData: { enabled: false, configured: false },
    });
    await expect(
      discoverPublicFeedbackSources(product, { environment: {} }),
    ).resolves.toEqual({ status: "disabled", provider: null, sources: [] });
  });

  it("reports an enabled provider without credentials as unavailable", async () => {
    await expect(
      discoverPublicFeedbackSources(product, {
        environment: { YOU_PUBLIC_DISCOVERY_ENABLED: "true" },
      }),
    ).resolves.toEqual({ status: "unavailable", provider: null, sources: [] });
  });

  it("does not construct the Bright Data boundary unless explicitly enabled", () => {
    const brightDataAdapter: PublicFeedbackDiscoveryAdapter = {
      id: "bright_data",
      discover: vi.fn(async () => []),
    };
    expect(
      createPublicFeedbackDiscoveryAdapters({
        environment: { BRIGHT_DATA_PUBLIC_DISCOVERY_ENABLED: "false" },
        brightDataAdapter,
      }),
    ).toEqual([]);
  });
});

describe("YouPublicFeedbackDiscoveryAdapter", () => {
  it("uses the official search boundary and returns only relevant public http(s) URLs", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            results: {
              web: [
                {
                  title: "Acme on the App Store",
                  url: "https://apps.apple.com/us/app/acme/id123?utm_source=search",
                  description: "Acme ratings and reviews",
                },
                {
                  title: "Acme Reviews | G2",
                  url: "https://www.g2.com/products/acme/reviews?ref=search",
                  description: "Acme customer reviews",
                },
                {
                  title: "Acme Reviews | G2 duplicate",
                  url: "https://www.g2.com/products/acme/reviews?utm_campaign=x",
                  description: "Acme customer reviews",
                },
                {
                  title: "OtherCo Reviews",
                  url: "https://www.g2.com/products/otherco/reviews",
                  description: "OtherCo customer reviews",
                },
                {
                  title: "Acme internal feedback",
                  url: "http://localhost:3000/feedback",
                },
                {
                  title: "Acme unsafe feedback",
                  url: "javascript:alert(1)",
                },
                {
                  title: "Acme homepage",
                  url: "https://acme.example/",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    const adapter = new YouPublicFeedbackDiscoveryAdapter({
      apiKey: "you-secret-key",
      fetchImpl,
      now: () => new Date("2026-07-20T12:00:00.000Z"),
    });

    const sources = await adapter.discover(product);

    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.kind)).toEqual([
      "app_store",
      "review_site",
    ]);
    expect(sources.map((source) => source.url)).toEqual([
      "https://apps.apple.com/us/app/acme/id123",
      "https://www.g2.com/products/acme/reviews",
    ]);
    expect(sources[0]?.provenance).toEqual({
      provider: "you",
      retrievedAt: "2026-07-20T12:00:00.000Z",
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe("https://ydc-index.io/v1/search");
    expect(url.searchParams.get("query")).toContain('"Acme"');
    expect(url.search).not.toContain("private product description");
    expect(url.toString()).not.toContain("you-secret-key");
    expect(new Headers(requestInit?.headers).get("X-API-Key")).toBe(
      "you-secret-key",
    );
  });

  it("builds a privacy-minimized query from a public hostname when name is absent", () => {
    const query = buildPublicFeedbackSearchQuery({
      productName: null,
      productUrl: "https://feelow.ai/product",
      productDescription: "Confidential positioning details",
    });
    expect(query).toContain('"feelow"');
    expect(query).not.toContain("Confidential");
  });

  it("requires HTTPS and restricts production credentials to the official host", () => {
    expect(
      () =>
        new YouPublicFeedbackDiscoveryAdapter({
          apiKey: "you-secret-key",
          endpoint: "http://ydc-index.io/v1/search",
        }),
    ).toThrow("must use https");
    expect(
      () =>
        new YouPublicFeedbackDiscoveryAdapter({
          apiKey: "you-secret-key",
          endpoint: "https://search.attacker.example/v1/search",
          production: true,
        }),
    ).toThrow("official host");
  });

  it("rejects an oversized declared response before reading its body", async () => {
    const text = vi.fn(async () => "{}");
    const adapter = new YouPublicFeedbackDiscoveryAdapter({
      apiKey: "you-secret-key",
      fetchImpl: vi.fn(async () => {
        const response = new Response(null, {
          status: 200,
          headers: { "Content-Length": "1000001" },
        });
        response.text = text;
        return response;
      }),
    });

    await expect(adapter.discover(product)).rejects.toThrow(
      "response too large",
    );
    expect(text).not.toHaveBeenCalled();
  });
});

describe("provider fallback", () => {
  it("falls back to an injected Bright Data client without leaking the primary error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const you: PublicFeedbackDiscoveryAdapter = {
      id: "you",
      discover: vi.fn(async () => {
        throw new Error("secret upstream response");
      }),
    };
    const brightDataDiscover = vi.fn(async () => [
          {
            title: "Acme Reviews | Trustpilot",
            url: "https://www.trustpilot.com/review/acme.example",
            description: "Acme customer reviews",
          },
        ]);
    const brightData = new BrightDataPublicFeedbackDiscoveryAdapter(
      { discover: brightDataDiscover },
      () => new Date("2026-07-20T12:30:00.000Z"),
    );

    const result = await discoverPublicFeedbackSources(product, {
      adapters: [you, brightData],
    });

    expect(result.status).toBe("completed");
    expect(result.provider).toBe("bright_data");
    expect(result.sources[0]).toMatchObject({
      host: "trustpilot.com",
      kind: "review_site",
      discoveredBy: "bright_data",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "secret upstream response",
    );
    expect(brightDataDiscover).toHaveBeenCalledWith({
      identity: "Acme",
      publicHostname: "acme.example",
      query: expect.stringContaining('"Acme"'),
    });
    expect(JSON.stringify(brightDataDiscover.mock.calls)).not.toContain(
      "private product description",
    );
  });

  it("returns a subtle unavailable state when every provider fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing: PublicFeedbackDiscoveryAdapter = {
      id: "you",
      discover: vi.fn(async () => {
        throw new Error("raw provider failure");
      }),
    };
    await expect(
      discoverPublicFeedbackSources(product, { adapters: [failing] }),
    ).resolves.toEqual({ status: "unavailable", provider: null, sources: [] });
  });
});
