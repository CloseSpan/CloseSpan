import { describe, expect, it, vi } from "vitest";
import worker, { triggerWorkflowAutomation } from "./index";

const env = {
  CLOSESPAN_ORIGIN: "https://www.closespan.com",
  CRON_SECRET: "test-workflow-secret",
} as Env;

describe("workflow scheduler Worker", () => {
  it("calls the protected automation route with the shared secret", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await triggerWorkflowAutomation(env, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.closespan.com/api/internal/workflow/automation",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-workflow-secret",
    );
    expect(init?.redirect).toBe("manual");
  });

  it("fails the scheduled event when CloseSpan rejects the request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(triggerWorkflowAutomation(env, fetcher)).rejects.toThrow(
      "HTTP 401",
    );
  });

  it("does not follow redirects from a misconfigured application origin", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/login" } }),
    );

    await expect(triggerWorkflowAutomation(env, fetcher)).rejects.toThrow(
      "HTTP 302",
    );
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("exposes only a minimal health endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://scheduler.example/health"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "closespan-workflow-scheduler",
    });
  });
});
