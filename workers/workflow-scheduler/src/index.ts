const AUTOMATION_PATH = "/api/internal/workflow/automation";
const REQUEST_TIMEOUT_MS = 25_000;

type Fetcher = typeof fetch;

export async function triggerWorkflowAutomation(
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const endpoint = new URL(AUTOMATION_PATH, env.CLOSESPAN_ORIGIN);
  if (endpoint.protocol !== "https:") {
    throw new Error("CLOSESPAN_ORIGIN must use HTTPS");
  }

  const response = await fetcher(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.CRON_SECRET}`,
      "User-Agent": "CloseSpan-Workflow-Scheduler/1.0",
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(`CloseSpan workflow automation returned HTTP ${response.status}`);
  }

  console.log(JSON.stringify({
    event: "workflow_automation_triggered",
    status: response.status,
  }));
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        { status: "ok", service: "closespan-workflow-scheduler" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
  ): Promise<void> {
    await triggerWorkflowAutomation(env);
  },
} satisfies ExportedHandler<Env>;
