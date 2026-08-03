import { describe, expect, it, vi } from "vitest";
import {
  discoverCompanyProfile,
  extractCompanyUrl,
} from "./company-profile-discovery";

const publicLookup = async () => [{ address: "93.184.216.34" }];

describe("company profile discovery", () => {
  it("extracts and normalizes a company domain from chat", () => {
    expect(extractCompanyUrl("Our website is acme.example/about.")).toBe(
      "https://acme.example/about",
    );
  });

  it("reads public identity metadata and stores a bounded logo data URL", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`
        <html><head>
          <meta property="og:site_name" content="Acme Cloud" />
          <meta name="description" content="Operations software for modern teams." />
          <link rel="icon" href="/brand.png" />
        </head></html>
      `, { headers: { "content-type": "text/html; charset=utf-8" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      }));

    const profile = await discoverCompanyProfile("acme.example", {
      fetch: fetcher,
      lookup: publicLookup,
    });

    expect(profile).toEqual({
      name: "Acme Cloud",
      url: "https://acme.example/",
      description: "Operations software for modern teams.",
      logo: "data:image/png;base64,iVBORw==",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL("https://acme.example/brand.png"),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects hostnames that resolve to private infrastructure", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(discoverCompanyProfile("internal.example", {
      fetch: fetcher,
      lookup: async () => [{ address: "127.0.0.1" }],
    })).rejects.toThrow("publicly reachable");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
