import type { HealthStatus, HistoryStatus, ServiceStatus } from "./domain";

export interface StatusDay {
  day: string;
  status: HistoryStatus;
  uptime: number | null;
  totalChecks: number;
}

export interface StatusService {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ServiceStatus;
  healthStatus: HealthStatus;
  uptime: number | null;
  lastCheckedAt: string | null;
  responseMs: number | null;
  days: StatusDay[];
}

export interface IncidentSummary {
  id: string;
  slug: string;
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  severity: "degraded" | "partial_outage" | "major_outage";
  source: "automatic" | "manual";
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  latestMessage: string;
}

export interface IncidentUpdate {
  id: string;
  status: IncidentSummary["status"];
  message: string;
  authorType: "automation" | "operator";
  createdAt: string;
}

export interface IncidentDetail extends IncidentSummary {
  updates: IncidentUpdate[];
}

export interface MaintenanceWindow {
  id: string;
  title: string;
  message: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StatusPayload {
  generatedAt: string;
  overallStatus: ServiceStatus;
  lastCheckedAt: string | null;
  services: StatusService[];
  activeIncidents: IncidentSummary[];
  activeMaintenance: MaintenanceWindow[];
}

export interface AdminBootstrap {
  actorEmail: string;
  services: Array<Pick<StatusService, "id" | "name" | "status">>;
  incidents: IncidentSummary[];
  maintenance: MaintenanceWindow[];
}
