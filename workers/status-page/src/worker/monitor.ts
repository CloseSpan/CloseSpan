import { nextServiceState, shouldDeferPrelaunchProbe, slugify, utcDay } from "../domain";
import type { ServiceRow } from "./db";
import { listServices } from "./db";
import { enqueueNotification, processNotificationOutbox } from "./notifications";

interface ProbeResult {
  succeeded: boolean;
  latencyMs: number;
  errorCode: string | null;
}

interface AutomaticIncidentRow {
  id: string;
  slug: string;
  title: string;
}

function probeUrl(service: ServiceRow, env: Env): string {
  if (service.probe_url) return service.probe_url;
  switch (service.id) {
    case "svc_website": return env.WEBSITE_URL;
    case "svc_application": return env.APPLICATION_URL;
    case "svc_api": return env.API_HEALTH_URL;
    case "svc_integrations": return `${env.COMPONENT_HEALTH_URL}?component=integrations`;
    case "svc_ai": return `${env.COMPONENT_HEALTH_URL}?component=ai`;
    case "svc_agent": return env.AGENT_EXECUTOR_URL ? `${env.AGENT_EXECUTOR_URL.replace(/\/$/, "")}/health?canary=1` : "";
    default: return "";
  }
}

async function readBoundedText(response: Response, maximum = 256_000): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximum) throw new Error("response_too_large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function errorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && /^[a-z_]+$/.test(error.message)) return error.message;
  return "network_error";
}

async function performProbe(service: ServiceRow, env: Env): Promise<ProbeResult> {
  const target = probeUrl(service, env);
  if (!target) return { succeeded: false, latencyMs: 0, errorCode: "not_configured" };
  const started = Date.now();
  try {
    const headers = new Headers({
      accept: service.probe_kind === "text" ? "text/html, text/plain;q=0.9" : "application/json",
      "user-agent": "CloseSpan-Status-Monitor/1.0",
    });
    if (service.probe_kind === "component" || service.probe_kind === "executor")
      headers.set("authorization", `Bearer ${env.STATUS_PROBE_SECRET}`);
    const response = await fetch(target, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      if (response.body) await response.body.cancel();
      return { succeeded: false, latencyMs, errorCode: `http_${response.status}` };
    }
    const body = await readBoundedText(response, service.probe_kind === "text" ? 256_000 : 32_000);
    if (service.probe_kind === "text") {
      return {
        succeeded: service.expected_text ? body.toLowerCase().includes(service.expected_text.toLowerCase()) : true,
        latencyMs,
        errorCode: service.expected_text && !body.toLowerCase().includes(service.expected_text.toLowerCase()) ? "content_mismatch" : null,
      };
    }

    let payload: unknown;
    try { payload = JSON.parse(body); } catch { return { succeeded: false, latencyMs, errorCode: "invalid_json" }; }
    if (!payload || typeof payload !== "object") return { succeeded: false, latencyMs, errorCode: "invalid_payload" };
    const record = payload as Record<string, unknown>;
    const healthy = record.status === "ok"
      && (service.probe_kind !== "api" || record.database === "connected")
      && (service.probe_kind !== "executor" || record.canary === "ready");
    return { succeeded: healthy, latencyMs, errorCode: healthy ? null : "unhealthy_payload" };
  } catch (error) {
    return { succeeded: false, latencyMs: Date.now() - started, errorCode: errorCode(error) };
  }
}

async function inMaintenance(db: D1Database, serviceId: string, now: number): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS active FROM maintenance_windows m
    JOIN maintenance_services ms ON ms.maintenance_id=m.id
    WHERE ms.service_id=? AND m.status IN ('scheduled','in_progress') AND m.starts_at<=? AND m.ends_at>=? LIMIT 1`)
    .bind(serviceId, now, now).first<{ active: number }>();
  return Boolean(row);
}

async function openAutomaticIncident(env: Env, service: ServiceRow, now: number): Promise<void> {
  const existing = await env.DB.prepare(`SELECT i.id,i.slug,i.title FROM incidents i
    JOIN incident_services x ON x.incident_id=i.id
    WHERE x.service_id=? AND i.source='automatic' AND i.status!='resolved' LIMIT 1`)
    .bind(service.id).first<AutomaticIncidentRow>();
  if (existing) return;
  const id = crypto.randomUUID();
  const title = service.id === "svc_integrations" ? `${service.name} are unavailable` : `${service.name} is unavailable`;
  const slug = `${slugify(title)}-${id.slice(0, 8)}`;
  const message = `Automated monitoring detected repeated failures for ${service.name}. The CloseSpan team is investigating.`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO incidents(id,slug,title,status,severity,source,created_at,updated_at)
      VALUES(?,?,?,'investigating','major_outage','automatic',?,?)`).bind(id, slug, title, now, now),
    env.DB.prepare(`INSERT INTO incident_services(incident_id,service_id) VALUES(?,?)`).bind(id, service.id),
    env.DB.prepare(`INSERT INTO incident_updates(id,incident_id,status,message,author_type,created_at)
      VALUES(?,?,'investigating',?,'automation',?)`).bind(crypto.randomUUID(), id, message, now),
  ]);
  await enqueueNotification(env.DB, `incident:${id}:opened`, {
    kind: "incident_opened",
    title,
    message,
    status: "Investigating",
    url: `${env.STATUS_PUBLIC_ORIGIN}/incidents/${slug}`,
    occurredAt: new Date(now).toISOString(),
  }, Boolean(env.STATUS_WEBHOOK_URL));
}

async function resolveAutomaticIncident(env: Env, service: ServiceRow, now: number): Promise<void> {
  const incident = await env.DB.prepare(`SELECT i.id,i.slug,i.title FROM incidents i
    JOIN incident_services x ON x.incident_id=i.id
    WHERE x.service_id=? AND i.source='automatic' AND i.status!='resolved' ORDER BY i.created_at DESC LIMIT 1`)
    .bind(service.id).first<AutomaticIncidentRow>();
  if (!incident) return;
  const message = `Automated checks confirm that ${service.name} has recovered and is operating normally.`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE incidents SET status='resolved',updated_at=?,resolved_at=? WHERE id=?`).bind(now, now, incident.id),
    env.DB.prepare(`INSERT INTO incident_updates(id,incident_id,status,message,author_type,created_at)
      VALUES(?,?,'resolved',?,'automation',?)`).bind(crypto.randomUUID(), incident.id, message, now),
  ]);
  await enqueueNotification(env.DB, `incident:${incident.id}:resolved`, {
    kind: "incident_resolved",
    title: incident.title,
    message,
    status: "Resolved",
    url: `${env.STATUS_PUBLIC_ORIGIN}/incidents/${incident.slug}`,
    occurredAt: new Date(now).toISOString(),
  }, Boolean(env.STATUS_WEBHOOK_URL));
}

async function checkService(service: ServiceRow, env: Env, scheduledAt: number): Promise<void> {
  const result = await performProbe(service, env);
  if (shouldDeferPrelaunchProbe({
    probeKind: service.probe_kind,
    lastCheckedAt: service.last_checked_at,
    succeeded: result.succeeded,
    errorCode: result.errorCode,
  })) return;
  const state = nextServiceState({
    currentStatus: service.current_status,
    consecutiveFailures: service.consecutive_failures,
    consecutiveSuccesses: service.consecutive_successes,
    consecutiveSlow: service.consecutive_slow,
    succeeded: result.succeeded,
    slow: result.succeeded && result.latencyMs >= service.latency_threshold_ms,
  });
  const maintenanceExcluded = await inMaintenance(env.DB, service.id, scheduledAt);
  const checkId = crypto.randomUUID();
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO checks
    (id,service_id,scheduled_at,checked_at,status,succeeded,latency_ms,maintenance_excluded,error_code)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      checkId,
      service.id,
      scheduledAt,
      Date.now(),
      state.status,
      result.succeeded ? 1 : 0,
      result.latencyMs,
      maintenanceExcluded ? 1 : 0,
      result.errorCode,
    ).run();
  if ((inserted.meta.changes ?? 0) === 0) return;

  await env.DB.prepare(`UPDATE services SET current_status=?,consecutive_failures=?,consecutive_successes=?,
    consecutive_slow=?,last_checked_at=?,last_response_ms=?,last_error=?,updated_at=? WHERE id=?`).bind(
      state.status,
      state.consecutiveFailures,
      state.consecutiveSuccesses,
      state.consecutiveSlow,
      scheduledAt,
      result.latencyMs,
      result.errorCode,
      Date.now(),
      service.id,
    ).run();

  if (!maintenanceExcluded && state.status === "major_outage" && service.current_status !== "major_outage")
    await openAutomaticIncident(env, service, scheduledAt);
  if (state.status === "operational" && service.current_status !== "operational")
    await resolveAutomaticIncident(env, service, scheduledAt);
}

async function rollupDay(db: D1Database, serviceId: string, day: string, now: number): Promise<void> {
  await db.prepare(`INSERT INTO daily_rollups
    (service_id,day,total_checks,successful_checks,degraded_checks,failed_checks,maintenance_checks,worst_status,calculated_at)
    SELECT ?,?,COUNT(*),
      SUM(CASE WHEN succeeded=1 AND maintenance_excluded=0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN status='degraded' AND succeeded=1 AND maintenance_excluded=0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN succeeded=0 AND maintenance_excluded=0 THEN 1 ELSE 0 END),
      SUM(maintenance_excluded),
      CASE
        WHEN SUM(CASE WHEN status='major_outage' AND maintenance_excluded=0 THEN 1 ELSE 0 END)>0 THEN 'major_outage'
        WHEN SUM(CASE WHEN status='partial_outage' AND maintenance_excluded=0 THEN 1 ELSE 0 END)>0 THEN 'partial_outage'
        WHEN SUM(CASE WHEN status='degraded' AND maintenance_excluded=0 THEN 1 ELSE 0 END)>0 THEN 'degraded'
        WHEN SUM(maintenance_excluded)>0 THEN 'maintenance'
        ELSE 'operational'
      END,
      ?
    FROM checks WHERE service_id=? AND date(checked_at / 1000, 'unixepoch')=?
    HAVING COUNT(*)>0
    ON CONFLICT(service_id,day) DO UPDATE SET
      total_checks=excluded.total_checks,successful_checks=excluded.successful_checks,
      degraded_checks=excluded.degraded_checks,failed_checks=excluded.failed_checks,
      maintenance_checks=excluded.maintenance_checks,worst_status=excluded.worst_status,calculated_at=excluded.calculated_at`)
    .bind(serviceId, day, now, serviceId, day).run();
}

async function updateMaintenance(env: Env, now: number): Promise<void> {
  const starting = await env.DB.prepare(`SELECT id,title,message FROM maintenance_windows
    WHERE status='scheduled' AND starts_at<=? AND ends_at>?`).bind(now, now).all<{ id: string; title: string; message: string }>();
  for (const window of starting.results) {
    await env.DB.prepare(`UPDATE maintenance_windows SET status='in_progress',updated_at=? WHERE id=? AND status='scheduled'`)
      .bind(now, window.id).run();
    await enqueueNotification(env.DB, `maintenance:${window.id}:started`, {
      kind: "maintenance_started",
      title: window.title,
      message: window.message,
      status: "Maintenance in progress",
      url: `${env.STATUS_PUBLIC_ORIGIN}/maintenance`,
      occurredAt: new Date(now).toISOString(),
    }, Boolean(env.STATUS_WEBHOOK_URL));
  }
  await env.DB.prepare(`UPDATE maintenance_windows SET status='completed',updated_at=?
    WHERE status='in_progress' AND ends_at<=?`).bind(now, now).run();
}

export async function runScheduledMonitoring(env: Env, scheduledAt: number): Promise<void> {
  const started = Date.now();
  await updateMaintenance(env, scheduledAt);
  const services = await listServices(env.DB);
  const dueServices = services.filter((service) => {
    const intervalMs = service.probe_interval_minutes * 60_000;
    return service.last_checked_at === null || scheduledAt - service.last_checked_at >= intervalMs;
  });
  const checks = await Promise.allSettled(
    dueServices.map((service) => checkService(service, env, scheduledAt)),
  );
  checks.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(JSON.stringify({
        event: "status_probe_failed",
        serviceId: dueServices[index]?.id,
        error: result.reason instanceof Error ? result.reason.message : "unknown",
      }));
    }
  });
  const today = utcDay(scheduledAt);
  const yesterday = utcDay(scheduledAt - 86_400_000);
  await Promise.all(dueServices.map((service) => rollupDay(env.DB, service.id, today, Date.now())));
  if (new Date(scheduledAt).getUTCHours() === 0 && new Date(scheduledAt).getUTCMinutes() === 0) {
    await Promise.all(services.map((service) => rollupDay(env.DB, service.id, yesterday, Date.now())));
  }
  if (new Date(scheduledAt).getUTCMinutes() === 0) {
    await Promise.all([
      env.DB.prepare(`DELETE FROM checks WHERE checked_at<?`).bind(scheduledAt - 14 * 86_400_000).run(),
      env.DB.prepare(`DELETE FROM daily_rollups WHERE day<?`).bind(utcDay(scheduledAt - 400 * 86_400_000)).run(),
    ]);
  }
  await processNotificationOutbox(env, scheduledAt);
  console.log(JSON.stringify({
    event: "status_monitor_completed",
    services: services.length,
    dueServices: dueServices.length,
    failedProbes: checks.filter((result) => result.status === "rejected").length,
    durationMs: Date.now() - started,
    scheduledAt,
  }));
}
