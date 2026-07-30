import { describe, expect, it, vi } from "vitest";
import worker, { triggerWorkflowAutomation } from "./index";

const env = {
  CLOSESPAN_ORIGIN: "https://closespan.com",
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
      "https://closespan.com/api/internal/workflow/automation",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-workflow-secret",
    );
    expect(init?.redirect).toBe("error");
  });

  it("fails the scheduled event when CloseSpan rejects the request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(triggerWorkflowAutomation(env, fetcher)).rejects.toThrow(
      "HTTP 401",
    );
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
