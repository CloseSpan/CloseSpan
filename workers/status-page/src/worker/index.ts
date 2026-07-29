import { authenticateAdmin, requireMutationOrigin } from "./auth";
import {
  adminBootstrap,
  changeIncidentSeverity,
  changeMaintenanceStatus,
  createMaintenance,
  createManualIncident,
  updateIncident,
} from "./admin";
import { getIncident, getStatus, listIncidents, listMaintenance } from "./db";
import { apiError, boundedJson, json, RequestError, withSecurityHeaders } from "./http";
import { runScheduledMonitoring } from "./monitor";

async function publicApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== "GET") return apiError(405, "Method not allowed.");
  if (path === "/api/status") {
    return json(await getStatus(env.DB), {
      headers: { "cache-control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30" },
    });
  }
  if (path === "/api/incidents") return json({ incidents: await listIncidents(env.DB) });
  if (path.startsWith("/api/incidents/")) {
    const slug = decodeURIComponent(path.slice("/api/incidents/".length));
    const incident = await getIncident(env.DB, slug);
    return incident ? json({ incident }) : apiError(404, "Incident was not found.");
  }
  if (path === "/api/maintenance") return json({ maintenance: await listMaintenance(env.DB) });
  if (path === "/api/health") {
    const database = await env.DB.prepare("SELECT 1 AS healthy").first<{ healthy: number }>();
    return json({ status: database?.healthy === 1 ? "ok" : "degraded", timestamp: new Date().toISOString() }, {
      status: database?.healthy === 1 ? 200 : 503,
    });
  }
  return apiError(404, "API route was not found.");
}

async function adminApi(request: Request, env: Env, path: string): Promise<Response> {
  const actorEmail = await authenticateAdmin(request, env);
  requireMutationOrigin(request, env);
  if (request.method === "GET" && path === "/api/admin/bootstrap")
    return json(await adminBootstrap(env, actorEmail));

  if (request.method === "POST" && path === "/api/admin/incidents")
    return json(await createManualIncident(env, actorEmail, await boundedJson(request)), { status: 201 });

  const incidentUpdate = path.match(/^\/api\/admin\/incidents\/([^/]+)\/updates$/);
  if (request.method === "POST" && incidentUpdate) {
    await updateIncident(env, actorEmail, decodeURIComponent(incidentUpdate[1]!), await boundedJson(request));
    return json({ updated: true });
  }

  const incidentPatch = path.match(/^\/api\/admin\/incidents\/([^/]+)$/);
  if (request.method === "PATCH" && incidentPatch) {
    await changeIncidentSeverity(env, actorEmail, decodeURIComponent(incidentPatch[1]!), await boundedJson(request));
    return json({ updated: true });
  }

  if (request.method === "POST" && path === "/api/admin/maintenance")
    return json(await createMaintenance(env, actorEmail, await boundedJson(request)), { status: 201 });

  const maintenancePatch = path.match(/^\/api\/admin\/maintenance\/([^/]+)$/);
  if (request.method === "PATCH" && maintenancePatch) {
    await changeMaintenanceStatus(env, actorEmail, decodeURIComponent(maintenancePatch[1]!), await boundedJson(request));
    return json({ updated: true });
  }
  return apiError(404, "Administrative route was not found.");
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/api/admin/")) return await adminApi(request, env, url.pathname);
    if (url.pathname.startsWith("/api/")) return await publicApi(request, env, url.pathname);
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) await authenticateAdmin(request, env);
    return withSecurityHeaders(await env.ASSETS.fetch(request), url.pathname);
  } catch (error) {
    if (error instanceof RequestError) return apiError(error.status, error.message);
    console.error(JSON.stringify({ event: "status_request_failed", path: url.pathname, error: error instanceof Error ? error.name : "unknown" }));
    return apiError(500, "The status service could not complete this request.");
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    try {
      await runScheduledMonitoring(env, controller.scheduledTime);
    } catch (error) {
      controller.noRetry();
      console.error(JSON.stringify({ event: "status_monitor_failed", scheduledAt: controller.scheduledTime, error: error instanceof Error ? error.message : "unknown" }));
    }
  },
} satisfies ExportedHandler<Env>;
