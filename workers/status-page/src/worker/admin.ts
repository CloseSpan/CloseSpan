import { slugify } from "../domain";
import { audit, getAdminBootstrap } from "./db";
import { RequestError } from "./http";
import { enqueueNotification } from "./notifications";

const severities = new Set(["degraded", "partial_outage", "major_outage"]);
const incidentStatuses = new Set(["investigating", "identified", "monitoring", "resolved"]);

function textField(value: unknown, name: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new RequestError(400, `${name} is required.`);
  const text = value.trim();
  if (text.length < minimum || text.length > maximum)
    throw new RequestError(400, `${name} must be between ${minimum} and ${maximum} characters.`);
  return text;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Request body must be an object.");
  return value as Record<string, unknown>;
}

async function serviceIds(db: D1Database, value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 || value.some((item) => typeof item !== "string"))
    throw new RequestError(400, "Select at least one valid service.");
  const ids = [...new Set(value as string[])];
  const placeholders = ids.map(() => "?").join(",");
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM services WHERE id IN (${placeholders}) AND enabled=1`)
    .bind(...ids).first<{ count: number }>();
  if (Number(row?.count ?? 0) !== ids.length) throw new RequestError(400, "One or more services are invalid.");
  return ids;
}

function notificationUrl(env: Env, slug: string): string {
  return `${env.STATUS_PUBLIC_ORIGIN}/incidents/${slug}`;
}

export async function adminBootstrap(env: Env, actorEmail: string): Promise<unknown> {
  return getAdminBootstrap(env.DB, actorEmail);
}

export async function createManualIncident(env: Env, actorEmail: string, raw: unknown): Promise<{ id: string; slug: string }> {
  const body = objectBody(raw);
  const title = textField(body.title, "Title", 3, 160);
  const message = textField(body.message, "Message", 3, 4_000);
  const severity = textField(body.severity, "Severity", 3, 30);
  if (!severities.has(severity)) throw new RequestError(400, "Select a valid incident severity.");
  const services = await serviceIds(env.DB, body.serviceIds);
  const id = crypto.randomUUID();
  const slug = `${slugify(title)}-${id.slice(0, 8)}`;
  const now = Date.now();
  const statements = [
    env.DB.prepare(`INSERT INTO incidents(id,slug,title,status,severity,source,created_at,updated_at)
      VALUES(?,?,?,'investigating',?,'manual',?,?)`).bind(id, slug, title, severity, now, now),
    env.DB.prepare(`INSERT INTO incident_updates(id,incident_id,status,message,author_type,author_email,created_at)
      VALUES(?,?,'investigating',?,'operator',?,?)`).bind(crypto.randomUUID(), id, message, actorEmail, now),
    ...services.map((serviceId) => env.DB.prepare(`INSERT INTO incident_services(incident_id,service_id) VALUES(?,?)`).bind(id, serviceId)),
  ];
  await env.DB.batch(statements);
  await audit(env.DB, actorEmail, "incident.created", "incident", id, { title, severity, services });
  await enqueueNotification(env.DB, `incident:${id}:opened`, {
    kind: "incident_opened",
    title,
    message,
    status: "Investigating",
    url: notificationUrl(env, slug),
    occurredAt: new Date(now).toISOString(),
  }, Boolean(env.STATUS_WEBHOOK_URL));
  return { id, slug };
}

export async function updateIncident(env: Env, actorEmail: string, incidentId: string, raw: unknown): Promise<void> {
  const body = objectBody(raw);
  const status = textField(body.status, "Status", 3, 30);
  const message = textField(body.message, "Message", 3, 4_000);
  if (!incidentStatuses.has(status)) throw new RequestError(400, "Select a valid incident status.");
  const incident = await env.DB.prepare(`SELECT id,slug,title,status FROM incidents WHERE id=?`).bind(incidentId)
    .first<{ id: string; slug: string; title: string; status: string }>();
  if (!incident) throw new RequestError(404, "Incident was not found.");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE incidents SET status=?,updated_at=?,resolved_at=? WHERE id=?`)
      .bind(status, now, status === "resolved" ? now : null, incidentId),
    env.DB.prepare(`INSERT INTO incident_updates(id,incident_id,status,message,author_type,author_email,created_at)
      VALUES(?,?,?,?,'operator',?,?)`).bind(crypto.randomUUID(), incidentId, status, message, actorEmail, now),
  ]);
  await audit(env.DB, actorEmail, "incident.updated", "incident", incidentId, { status });
  await enqueueNotification(env.DB, `incident:${incidentId}:update:${now}`, {
    kind: status === "resolved" ? "incident_resolved" : "incident_updated",
    title: incident.title,
    message,
    status: status.replaceAll("_", " "),
    url: notificationUrl(env, incident.slug),
    occurredAt: new Date(now).toISOString(),
  }, Boolean(env.STATUS_WEBHOOK_URL));
}

export async function changeIncidentSeverity(env: Env, actorEmail: string, incidentId: string, raw: unknown): Promise<void> {
  const body = objectBody(raw);
  const severity = textField(body.severity, "Severity", 3, 30);
  if (!severities.has(severity)) throw new RequestError(400, "Select a valid incident severity.");
  const result = await env.DB.prepare(`UPDATE incidents SET severity=?,updated_at=? WHERE id=?`).bind(severity, Date.now(), incidentId).run();
  if ((result.meta.changes ?? 0) === 0) throw new RequestError(404, "Incident was not found.");
  await audit(env.DB, actorEmail, "incident.severity_changed", "incident", incidentId, { severity });
}

export async function createMaintenance(env: Env, actorEmail: string, raw: unknown): Promise<{ id: string }> {
  const body = objectBody(raw);
  const title = textField(body.title, "Title", 3, 160);
  const message = textField(body.message, "Message", 3, 4_000);
  const startsAt = typeof body.startsAt === "string" ? Date.parse(body.startsAt) : Number.NaN;
  const endsAt = typeof body.endsAt === "string" ? Date.parse(body.endsAt) : Number.NaN;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt)
    throw new RequestError(400, "Maintenance must have a valid start and end time.");
  if (endsAt - startsAt > 7 * 86_400_000) throw new RequestError(400, "Maintenance cannot exceed seven days.");
  const services = await serviceIds(env.DB, body.serviceIds);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO maintenance_windows
      (id,title,message,starts_at,ends_at,status,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'scheduled',?,?,?)`).bind(id, title, message, startsAt, endsAt, actorEmail, now, now),
    ...services.map((serviceId) => env.DB.prepare(`INSERT INTO maintenance_services(maintenance_id,service_id) VALUES(?,?)`).bind(id, serviceId)),
  ]);
  await audit(env.DB, actorEmail, "maintenance.created", "maintenance", id, { title, startsAt, endsAt, services });
  await enqueueNotification(env.DB, `maintenance:${id}:scheduled`, {
    kind: "maintenance_scheduled",
    title,
    message,
    status: "Scheduled maintenance",
    url: `${env.STATUS_PUBLIC_ORIGIN}/maintenance`,
    occurredAt: new Date(now).toISOString(),
  }, Boolean(env.STATUS_WEBHOOK_URL));
  return { id };
}

export async function changeMaintenanceStatus(env: Env, actorEmail: string, maintenanceId: string, raw: unknown): Promise<void> {
  const body = objectBody(raw);
  const status = textField(body.status, "Status", 3, 30);
  if (status !== "completed" && status !== "cancelled") throw new RequestError(400, "Maintenance may only be completed or cancelled manually.");
  const result = await env.DB.prepare(`UPDATE maintenance_windows SET status=?,updated_at=? WHERE id=?`)
    .bind(status, Date.now(), maintenanceId).run();
  if ((result.meta.changes ?? 0) === 0) throw new RequestError(404, "Maintenance window was not found.");
  await audit(env.DB, actorEmail, `maintenance.${status}`, "maintenance", maintenanceId, { status });
}
