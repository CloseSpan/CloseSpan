import type {
  AdminBootstrap,
  IncidentDetail,
  IncidentSummary,
  IncidentUpdate,
  MaintenanceWindow,
  StatusPayload,
  StatusService,
} from "../contracts";
import { historyDays, overallStatus, type HealthStatus, type ServiceStatus, uptimePercentage } from "../domain";

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  sort_order: number;
  probe_kind: "text" | "api" | "component" | "executor";
  probe_url: string;
  expected_text: string | null;
  probe_interval_minutes: number;
  latency_threshold_ms: number;
  current_status: HealthStatus;
  consecutive_failures: number;
  consecutive_successes: number;
  consecutive_slow: number;
  last_checked_at: number | null;
  last_response_ms: number | null;
  last_error: string | null;
}

interface RollupRow {
  service_id: string;
  day: string;
  total_checks: number;
  successful_checks: number;
  degraded_checks: number;
  failed_checks: number;
  maintenance_checks: number;
  worst_status: ServiceStatus;
}

interface IncidentRow {
  id: string;
  slug: string;
  title: string;
  status: IncidentSummary["status"];
  severity: IncidentSummary["severity"];
  source: IncidentSummary["source"];
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
  latest_message: string | null;
  service_ids: string | null;
}

interface IncidentUpdateRow {
  id: string;
  status: IncidentSummary["status"];
  message: string;
  author_type: "automation" | "operator";
  created_at: number;
}

interface MaintenanceRow {
  id: string;
  title: string;
  message: string;
  starts_at: number;
  ends_at: number;
  status: MaintenanceWindow["status"];
  created_at: number;
  updated_at: number;
  service_ids: string | null;
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function splitIds(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function incidentFromRow(row: IncidentRow): IncidentSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    severity: row.severity,
    source: row.source,
    serviceIds: splitIds(row.service_ids),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    resolvedAt: iso(row.resolved_at),
    latestMessage: row.latest_message ?? "Status investigation is in progress.",
  };
}

function maintenanceFromRow(row: MaintenanceRow): MaintenanceWindow {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at)!,
    status: row.status,
    serviceIds: splitIds(row.service_ids),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

const incidentSelect = `
  SELECT i.id,i.slug,i.title,i.status,i.severity,i.source,i.created_at,i.updated_at,i.resolved_at,
    (SELECT iu.message FROM incident_updates iu WHERE iu.incident_id=i.id ORDER BY iu.created_at DESC LIMIT 1) AS latest_message,
    (SELECT group_concat(services.id) FROM incident_services x JOIN services ON services.id=x.service_id WHERE x.incident_id=i.id) AS service_ids
  FROM incidents i`;

const maintenanceSelect = `
  SELECT m.id,m.title,m.message,m.starts_at,m.ends_at,m.status,m.created_at,m.updated_at,
    (SELECT group_concat(services.id) FROM maintenance_services x JOIN services ON services.id=x.service_id WHERE x.maintenance_id=m.id) AS service_ids
  FROM maintenance_windows m`;

export async function listServices(db: D1Database): Promise<ServiceRow[]> {
  const result = await db.prepare(`SELECT id,slug,name,description,sort_order,probe_kind,probe_url,expected_text,
    probe_interval_minutes,latency_threshold_ms,current_status,consecutive_failures,consecutive_successes,
    consecutive_slow,last_checked_at,last_response_ms,last_error FROM services WHERE enabled=1 ORDER BY sort_order`).all<ServiceRow>();
  return result.results;
}

export async function listIncidents(db: D1Database, activeOnly = false): Promise<IncidentSummary[]> {
  const where = activeOnly ? " WHERE i.status != 'resolved'" : "";
  const result = await db.prepare(`${incidentSelect}${where} ORDER BY i.created_at DESC LIMIT 100`).all<IncidentRow>();
  return result.results.map(incidentFromRow);
}

export async function getIncident(db: D1Database, slug: string): Promise<IncidentDetail | null> {
  const row = await db.prepare(`${incidentSelect} WHERE i.slug=? LIMIT 1`).bind(slug).first<IncidentRow>();
  if (!row) return null;
  const updates = await db.prepare(`SELECT id,status,message,author_type,created_at FROM incident_updates
    WHERE incident_id=? ORDER BY created_at DESC`).bind(row.id).all<IncidentUpdateRow>();
  return {
    ...incidentFromRow(row),
    updates: updates.results.map<IncidentUpdate>((update) => ({
      id: update.id,
      status: update.status,
      message: update.message,
      authorType: update.author_type,
      createdAt: iso(update.created_at)!,
    })),
  };
}

export async function listMaintenance(db: D1Database, includePast = true): Promise<MaintenanceWindow[]> {
  const where = includePast ? "" : " WHERE m.status IN ('scheduled','in_progress')";
  const result = await db.prepare(`${maintenanceSelect}${where} ORDER BY m.starts_at DESC LIMIT 100`).all<MaintenanceRow>();
  return result.results.map(maintenanceFromRow);
}

export async function getStatus(db: D1Database, now = Date.now()): Promise<StatusPayload> {
  const services = await listServices(db);
  const days = historyDays(now);
  const start = days[0]!;
  const rollups = await db.prepare(`SELECT service_id,day,total_checks,successful_checks,degraded_checks,failed_checks,
    maintenance_checks,worst_status FROM daily_rollups WHERE day>=? ORDER BY day`).bind(start).all<RollupRow>();
  const maintenance = await listMaintenance(db, false);
  const activeMaintenance = maintenance.filter((window) => Date.parse(window.startsAt) <= now && Date.parse(window.endsAt) >= now && window.status !== "cancelled");
  const activeMaintenanceServices = new Set(activeMaintenance.flatMap((window) => window.serviceIds));
  const activeIncidents = await listIncidents(db, true);
  const byServiceDay = new Map(rollups.results.map((row) => [`${row.service_id}:${row.day}`, row]));

  const serviceViews: StatusService[] = services.map((service) => {
    const serviceRollups = rollups.results.filter((row) => row.service_id === service.id);
    const total = serviceRollups.reduce((sum, row) => sum + row.total_checks, 0);
    const successes = serviceRollups.reduce((sum, row) => sum + row.successful_checks, 0);
    const maintenanceChecks = serviceRollups.reduce((sum, row) => sum + row.maintenance_checks, 0);
    const displayStatus: ServiceStatus = activeMaintenanceServices.has(service.id) ? "maintenance" : service.current_status;
    return {
      id: service.id,
      slug: service.slug,
      name: service.name,
      description: service.description,
      status: displayStatus,
      healthStatus: service.current_status,
      uptime: uptimePercentage(successes, total, maintenanceChecks),
      lastCheckedAt: iso(service.last_checked_at),
      responseMs: service.last_response_ms,
      days: days.map((day) => {
        const row = byServiceDay.get(`${service.id}:${day}`);
        return row ? {
          day,
          status: row.worst_status,
          uptime: uptimePercentage(row.successful_checks, row.total_checks, row.maintenance_checks),
          totalChecks: row.total_checks,
        } : { day, status: "no_data", uptime: null, totalChecks: 0 };
      }),
    };
  });

  const checked = services.map((service) => service.last_checked_at).filter((value): value is number => value !== null);
  return {
    generatedAt: new Date(now).toISOString(),
    overallStatus: overallStatus(serviceViews.map((service) => service.status)),
    lastCheckedAt: checked.length ? iso(Math.max(...checked)) : null,
    services: serviceViews,
    activeIncidents,
    activeMaintenance,
  };
}

export async function getAdminBootstrap(db: D1Database, actorEmail: string): Promise<AdminBootstrap> {
  const status = await getStatus(db);
  return {
    actorEmail,
    services: status.services.map(({ id, name, status: serviceStatus }) => ({ id, name, status: serviceStatus })),
    incidents: await listIncidents(db),
    maintenance: await listMaintenance(db),
  };
}

export async function audit(db: D1Database, actorEmail: string, action: string, resourceType: string, resourceId: string, detail: unknown): Promise<void> {
  await db.prepare(`INSERT INTO audit_events(id,actor_email,action,resource_type,resource_id,detail_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), actorEmail, action, resourceType, resourceId, JSON.stringify(detail), Date.now()).run();
}
