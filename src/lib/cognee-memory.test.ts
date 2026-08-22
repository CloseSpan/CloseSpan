import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkCogneeConnection,
  parseCogneeMatches,
  resetCogneeMemoryCacheForTest,
  retrieveCogneeProblemMemory,
} from "./cognee-memory";

const feedback = [{
  id: "fb_menu",
  source: "Slack",
  accountTier: "Unknown",
  environment: "Slack #feedback",
  quote: "The three-dot menu should include Share and Delete.",
}];

const candidates = [{
  id: "prob_menu",
  title: "Add photo menu actions",
  statement: "Customers need more actions in the photo menu.",
  productArea: "Photo detail",
  severity: "Low",
}];

afterEach(() => {
  resetCogneeMemoryCacheForTest();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Cognee problem memory", () => {
  it("parses flexible chunk results, filters unknown problems, and preserves rank", () => {
    expect(parseCogneeMatches(
      [
        { search_result: { text: "CLOSESPAN_PROBLEM_ID:prob_menu\nPhoto menu" } },
        { search_result: ["CLOSESPAN_PROBLEM_ID:prob_unknown", "ignored"] },
        { search_result: "Duplicate CLOSESPAN_PROBLEM_ID:prob_menu" },
        { search_result: "CLOSESPAN_PROBLEM_ID:prob_export\nExport issue" },
      ],
      ["prob_menu", "prob_export"],
    )).toEqual([
      expect.objectContaining({ problemId: "prob_menu", rank: 1 }),
      expect.objectContaining({ problemId: "prob_export", rank: 2 }),
    ]);
  });

  it("falls back without making a request when Cognee is not configured", async () => {
    vi.stubEnv("COGNEE_BASE_URL", "");
    vi.stubEnv("COGNEE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(retrieveCogneeProblemMemory({
      orgId: "org_alpha",
      feedback,
      candidates,
    })).resolves.toEqual({ status: "not_configured", datasetName: null, feedback: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("indexes redacted workspace memory and retrieves allow-listed candidates", async () => {
    vi.stubEnv("COGNEE_BASE_URL", "https://cognee.example");
    vi.stubEnv("COGNEE_API_KEY", "cognee-test-secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      void init;
      if (url.endsWith("/api/v1/remember")) return Response.json({ status: "ok" });
      if (url.endsWith("/api/v1/search")) {
        return Response.json([{ search_result: "CLOSESPAN_PROBLEM_ID:prob_menu\nPhoto menu" }]);
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await retrieveCogneeProblemMemory({
      orgId: "org_alpha",
      feedback,
      candidates,
    });

    expect(result.status).toBe("used");
    expect(result.datasetName).toMatch(/^closespan_[a-f0-9]{20}_problem_memory$/);
    expect(result.datasetName).not.toContain("org_alpha");
    expect(result.feedback).toEqual([{
      feedbackId: "fb_menu",
      matches: [expect.objectContaining({ problemId: "prob_menu", rank: 1 })],
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const rememberInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(rememberInit.headers).toEqual(expect.objectContaining({
      "X-Api-Key": "cognee-test-secret",
    }));
    const form = rememberInit.body as FormData;
    expect(form.get("datasetName")).toBe(result.datasetName);
    expect(form.get("run_in_background")).toBe("false");

    const searchInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const searchBody = JSON.parse(String(searchInit.body)) as {
      datasets: string[];
      query: string;
    };
    expect(searchBody.datasets).toEqual([result.datasetName]);
    expect(searchBody.query).toBe(feedback[0].quote);
  });

  it("does not block analysis when Cognee is unavailable", async () => {
    vi.stubEnv("COGNEE_BASE_URL", "https://cognee.example/api/v1");
    vi.stubEnv("COGNEE_API_KEY", "cognee-test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 503 })));

    await expect(retrieveCogneeProblemMemory({
      orgId: "org_alpha",
      feedback,
      candidates,
    })).resolves.toEqual({
      status: "unavailable",
      datasetName: expect.stringMatching(/^closespan_[a-f0-9]{20}_problem_memory$/),
      feedback: [],
    });
  });

  it("checks the configured Cognee health endpoint without exposing the key", async () => {
    vi.stubEnv(
      "COGNEE_BASE_URL",
      "[https://cognee.example/](https://cognee.example/)",
    );
    vi.stubEnv("COGNEE_API_KEY", "cognee-test-secret");
    const fetchMock = vi.fn(async () => Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkCogneeConnection()).resolves.toEqual({
      configured: true,
      healthy: true,
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cognee.example/health",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-Api-Key": "cognee-test-secret" }),
      }),
    );
  });
});
