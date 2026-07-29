import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AdminBootstrap, IncidentDetail, IncidentSummary, MaintenanceWindow, StatusPayload, StatusService } from "./contracts";
import type { HistoryStatus, ServiceStatus } from "./domain";
import "./styles.css";

const statusLabels: Record<ServiceStatus, string> = {
  operational: "Operational",
  degraded: "Degraded performance",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Under maintenance",
};

const headline: Record<ServiceStatus, { title: string; detail: string }> = {
  operational: { title: "All services are online", detail: "CloseSpan is operating normally." },
  degraded: { title: "Some services are degraded", detail: "We are investigating slower or inconsistent service." },
  partial_outage: { title: "A service is unavailable", detail: "The team is actively working to restore full service." },
  major_outage: { title: "Multiple services are unavailable", detail: "We are responding to a major service interruption." },
  maintenance: { title: "Planned maintenance is underway", detail: "Some services may be temporarily affected." },
};

function StatusIcon({ status, size = 20 }: { status: ServiceStatus; size?: number }) {
  if (status === "operational") return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>;
  if (status === "maintenance") return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 3.6 12 2 17l5-1.6L15.4 7l2.3 2.3a4 4 0 0 0-3-3Z" /></svg>;
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10.3 3.6 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /></svg>;
}

function CloseSpanMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /></span>;
}

function formatDate(value: string, includeTime = true): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : { timeZone: "UTC" }),
  }).format(new Date(value));
}

function timeAgo(value: string | null): string {
  if (!value) return "Waiting for first check";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Request failed with HTTP ${response.status}`);
  return payload as T;
}

function Layout({ children, active }: { children: ReactNode; active: "status" | "maintenance" | "incidents" | "admin" }) {
  return <div className="site-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="CloseSpan status home"><CloseSpanMark /><span>CloseSpan</span><span className="brand-divider" /><span className="brand-status">Status</span></a>
      <nav aria-label="Status navigation">
        <a className={active === "status" ? "active" : ""} href="/">Status</a>
        <a className={active === "maintenance" ? "active" : ""} href="/maintenance">Maintenance</a>
        <a className={active === "incidents" ? "active" : ""} href="/incidents">Previous incidents</a>
      </nav>
    </header>
    <main>{children}</main>
    <footer><span>© {new Date().getUTCFullYear()} CloseSpan</span><span>Independent service monitoring</span><a href="https://www.closespan.com">Return to CloseSpan</a></footer>
  </div>;
}

function PageIntro({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></div>;
}

function LoadingCard() {
  return <div className="loading-card" aria-live="polite"><span className="spinner" /><p>Loading current status…</p></div>;
}

function ErrorCard({ error, retry }: { error: string; retry: () => void }) {
  return <div className="message-card error-card" role="alert"><div><strong>Status data is temporarily unavailable</strong><p>{error}</p></div><button onClick={retry}>Try again</button></div>;
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  return <span className={`status-badge status-${status}`}><StatusIcon status={status} size={15} />{statusLabels[status]}</span>;
}

function HistoryBars({ service }: { service: StatusService }) {
  const measuredDays = service.days.filter((day) => day.totalChecks > 0);
  return <div className="history-wrap">
    <div className="history-bars" aria-hidden="true">
      {service.days.map((day) => {
        const label = day.status === "no_data"
          ? `${formatDate(`${day.day}T00:00:00Z`, false)}: no monitoring data`
          : `${formatDate(`${day.day}T00:00:00Z`, false)}: ${day.status === "maintenance" ? "scheduled maintenance" : statusLabels[day.status]}, ${day.uptime === null ? "uptime unavailable" : `${day.uptime}% uptime`}`;
        return <span className={`history-day day-${day.status}`} key={day.day} title={label} />;
      })}
    </div>
    <div className="history-axis"><span>90 days ago</span><span>Today</span></div>
    <details className="daily-details"><summary>View daily check details</summary>{measuredDays.length === 0 ? <p>No monitoring data has been collected yet.</p> : <div className="daily-table" role="table" aria-label={`${service.name} daily availability`}><div role="row" className="daily-table-head"><span role="columnheader">Date</span><span role="columnheader">Status</span><span role="columnheader">Uptime</span></div>{measuredDays.map((day) => <div role="row" key={day.day}><span role="cell">{formatDate(`${day.day}T00:00:00Z`, false)}</span><span role="cell">{day.status === "maintenance" ? "Scheduled maintenance" : day.status === "no_data" ? "No data" : statusLabels[day.status]}</span><span role="cell">{day.uptime === null ? "Not calculated" : `${day.uptime}%`}</span></div>)}</div>}</details>
  </div>;
}

function ServiceRow({ service }: { service: StatusService }) {
  const awaitingFirstCheck = service.lastCheckedAt === null;
  return <article className="service-row">
    <div className="service-heading">
      <div>{awaitingFirstCheck ? <span className="service-dot status-no_data" aria-hidden="true">·</span> : <span className={`service-dot status-${service.status}`}><StatusIcon status={service.status} size={14} /></span>}<div><h3>{service.name}</h3><p>{service.description}</p></div></div>
      <div className="uptime"><strong className={service.uptime === null ? "no-data" : ""}>{service.uptime === null ? "No data" : `${service.uptime}%`}</strong><span>90-day uptime</span></div>
    </div>
    <HistoryBars service={service} />
    <div className="service-meta">{awaitingFirstCheck ? <span className="awaiting-badge">Awaiting first check</span> : <StatusBadge status={service.status} />}<span>{service.responseMs === null ? "No response time yet" : `${service.responseMs} ms last response`}</span><span>Checked {timeAgo(service.lastCheckedAt)}</span></div>
  </article>;
}

function IncidentCard({ incident }: { incident: IncidentSummary }) {
  return <article className="timeline-card">
    <div className="timeline-top"><div><p className="date-label">{formatDate(incident.createdAt)}</p><h3><a href={`/incidents/${incident.slug}`}>{incident.title}</a></h3></div><StatusBadge status={incident.severity} /></div>
    <p>{incident.latestMessage}</p>
    <div className="card-meta"><span className={`incident-state state-${incident.status}`}>{incident.status.replaceAll("_", " ")}</span><span>{incident.source === "automatic" ? "Detected automatically" : "Published by CloseSpan"}</span></div>
  </article>;
}

function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    api<StatusPayload>("/api/status").then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load status."));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(load, 60_000); return () => window.clearInterval(timer); }, [load]);
  const awaitingServices = data?.services.filter((service) => service.lastCheckedAt === null).length ?? 0;
  return <Layout active="status">
    <section className="hero-space">
      {error ? <ErrorCard error={error} retry={load} /> : !data ? <LoadingCard /> : <>
        <div className={`overall-card ${data.lastCheckedAt ? `status-${data.overallStatus}` : "status-no_data"}`}>
          <span className="overall-icon">{data.lastCheckedAt ? <StatusIcon status={data.overallStatus} size={24} /> : <span className="awaiting-glyph" aria-hidden="true" />}</span>
          <div><h1>{!data.lastCheckedAt ? "Monitoring is starting" : awaitingServices > 0 ? "Monitored services are online" : headline[data.overallStatus].title}</h1><p>{!data.lastCheckedAt ? "No availability checks have completed yet." : awaitingServices > 0 ? `${awaitingServices} service checks are waiting for their production canaries.` : headline[data.overallStatus].detail}</p></div>
          <div className="last-updated"><span>Last checked</span><strong>{timeAgo(data.lastCheckedAt)}</strong></div>
        </div>
        {data.activeIncidents.length > 0 && <section className="active-block" aria-labelledby="active-incidents"><div className="section-title"><div><p className="eyebrow">Live response</p><h2 id="active-incidents">Active incidents</h2></div><span>{data.activeIncidents.length}</span></div>{data.activeIncidents.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</section>}
        {data.activeMaintenance.length > 0 && <section className="maintenance-notice"><StatusIcon status="maintenance" /><div><strong>{data.activeMaintenance[0]!.title}</strong><p>{data.activeMaintenance[0]!.message}</p></div><a href="/maintenance">View maintenance</a></section>}
        <section className="services-card" aria-labelledby="service-status">
          <div className="services-header"><div><p className="eyebrow">Live health checks</p><h2 id="service-status">Current status by service</h2></div>{awaitingServices > 0 ? <span className="awaiting-badge">{awaitingServices} checks pending</span> : data.lastCheckedAt ? <StatusBadge status={data.overallStatus} /> : <span className="awaiting-badge">Awaiting checks</span>}</div>
          <div className="services-list">{data.services.map((service) => <ServiceRow service={service} key={service.id} />)}</div>
        </section>
        <p className="monitoring-note">Availability is calculated from real monitoring checks. Scheduled maintenance and dates before monitoring began are excluded.</p>
      </>}
    </section>
  </Layout>;
}

function IncidentsPage() {
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ incidents: IncidentSummary[] }>("/api/incidents").then((value) => setIncidents(value.incidents)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load incidents.")), []);
  useEffect(() => { void load(); }, [load]);
  return <Layout active="incidents"><PageIntro eyebrow="Service history" title="Previous incidents" detail="A transparent record of CloseSpan service interruptions and recovery updates." />
    {error ? <ErrorCard error={error} retry={load} /> : incidents === null ? <LoadingCard /> : incidents.length === 0 ? <EmptyState title="No incidents reported" detail="Monitoring history begins when this status service goes live." /> : <section className="timeline-list">{incidents.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</section>}
  </Layout>;
}

function IncidentPage({ slug }: { slug: string }) {
  const [incident, setIncident] = useState<IncidentDetail | null | undefined>(undefined);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ incident: IncidentDetail }>(`/api/incidents/${encodeURIComponent(slug)}`).then((value) => setIncident(value.incident)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load incident.")), [slug]);
  useEffect(() => { void load(); }, [load]);
  return <Layout active="incidents">
    {error ? <ErrorCard error={error} retry={load} /> : incident === undefined ? <LoadingCard /> : incident === null ? <EmptyState title="Incident not found" detail="This incident may have been removed or the link may be incorrect." /> : <>
      <div className="incident-hero"><a className="back-link" href="/incidents">← Previous incidents</a><div className="incident-title"><div><p className="eyebrow">Incident report</p><h1>{incident.title}</h1><p>Opened {formatDate(incident.createdAt)}</p></div><StatusBadge status={incident.severity} /></div></div>
      <section className="incident-timeline" aria-label="Incident updates">{incident.updates.map((update) => <article key={update.id}><span className={`timeline-pin state-${update.status}`} /><div><div className="update-heading"><strong>{update.status.replaceAll("_", " ")}</strong><time dateTime={update.createdAt}>{formatDate(update.createdAt)}</time></div><p>{update.message}</p><span>{update.authorType === "automation" ? "CloseSpan monitoring" : "CloseSpan team"}</span></div></article>)}</section>
    </>}
  </Layout>;
}

function MaintenanceCard({ window: maintenance }: { window: MaintenanceWindow }) {
  return <article className="timeline-card maintenance-card"><div className="timeline-top"><div><p className="date-label">{formatDate(maintenance.startsAt)} – {formatDate(maintenance.endsAt)}</p><h3>{maintenance.title}</h3></div><span className={`incident-state state-${maintenance.status}`}>{maintenance.status.replaceAll("_", " ")}</span></div><p>{maintenance.message}</p></article>;
}

function MaintenancePage() {
  const [items, setItems] = useState<MaintenanceWindow[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ maintenance: MaintenanceWindow[] }>("/api/maintenance").then((value) => setItems(value.maintenance)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load maintenance.")), []);
  useEffect(() => { void load(); }, [load]);
  const visible = items?.filter((item) => item.status !== "cancelled") ?? [];
  return <Layout active="maintenance"><PageIntro eyebrow="Planned work" title="Maintenance" detail="Scheduled work that may affect CloseSpan availability or performance." />
    {error ? <ErrorCard error={error} retry={load} /> : items === null ? <LoadingCard /> : visible.length === 0 ? <EmptyState title="No maintenance scheduled" detail="There are no active or upcoming maintenance windows." /> : <section className="timeline-list">{visible.map((item) => <MaintenanceCard window={item} key={item.id} />)}</section>}
  </Layout>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span><StatusIcon status="operational" size={24} /></span><h2>{title}</h2><p>{detail}</p></div>;
}

function ServiceSelector({ services, selected, setSelected }: { services: AdminBootstrap["services"]; selected: string[]; setSelected: (ids: string[]) => void }) {
  return <fieldset className="service-selector"><legend>Affected services</legend>{services.map((service) => <label key={service.id}><input type="checkbox" checked={selected.includes(service.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, service.id] : selected.filter((id) => id !== service.id))} /><span>{service.name}</span></label>)}</fieldset>;
}

function AdminPage() {
  const [data, setData] = useState<AdminBootstrap | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [incidentServices, setIncidentServices] = useState<string[]>([]);
  const [maintenanceServices, setMaintenanceServices] = useState<string[]>([]);
  const load = useCallback(() => api<AdminBootstrap>("/api/admin/bootstrap").then((value) => { setData(value); setIncidentServices(value.services.map((service) => service.id)); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load administration.")), []);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>, endpoint: string, serviceIds: string[], success: string) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ ...payload, serviceIds }) });
      event.currentTarget.reset(); setNotice(success); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The change could not be published."); }
    finally { setBusy(false); }
  };
  return <Layout active="admin"><PageIntro eyebrow="Protected operations" title="Status administration" detail="Publish incidents, customer updates, and planned maintenance. Every change is audited." />
    {error && <div className="inline-alert" role="alert">{error}</div>}{notice && <div className="inline-alert success" role="status">{notice}</div>}
    {!data ? !error && <LoadingCard /> : <div className="admin-layout">
      <aside className="operator-card"><span>Signed in with Cloudflare Access</span><strong>{data.actorEmail}</strong><p>Changes publish immediately to the public status page.</p></aside>
      <section className="admin-grid">
        <form className="admin-form" onSubmit={(event) => void submit(event, "/api/admin/incidents", incidentServices, "Incident published.")}><div><p className="eyebrow">Manual incident</p><h2>Publish an incident</h2></div><label>Title<input name="title" required minLength={3} maxLength={160} placeholder="API requests are failing" /></label><label>Customer update<textarea name="message" required minLength={3} maxLength={4000} rows={4} placeholder="We are investigating elevated errors…" /></label><label>Severity<select name="severity" defaultValue="degraded"><option value="degraded">Degraded performance</option><option value="partial_outage">Partial outage</option><option value="major_outage">Major outage</option></select></label><ServiceSelector services={data.services} selected={incidentServices} setSelected={setIncidentServices} /><button disabled={busy || incidentServices.length === 0}>Publish incident</button></form>
        <form className="admin-form" onSubmit={(event) => void submit(event, "/api/admin/maintenance", maintenanceServices, "Maintenance scheduled.")}><div><p className="eyebrow">Planned work</p><h2>Schedule maintenance</h2></div><label>Title<input name="title" required minLength={3} maxLength={160} placeholder="Database maintenance" /></label><label>Customer message<textarea name="message" required minLength={3} maxLength={4000} rows={4} placeholder="CloseSpan may be briefly unavailable…" /></label><div className="date-grid"><label>Starts<input name="startsAt" type="datetime-local" required /></label><label>Ends<input name="endsAt" type="datetime-local" required /></label></div><ServiceSelector services={data.services} selected={maintenanceServices} setSelected={setMaintenanceServices} /><button disabled={busy || maintenanceServices.length === 0}>Schedule maintenance</button></form>
      </section>
      <section className="admin-records"><div className="section-title"><div><p className="eyebrow">Incident response</p><h2>Publish an update</h2></div></div>{data.incidents.filter((incident) => incident.status !== "resolved").length === 0 ? <p className="muted">No open incidents.</p> : data.incidents.filter((incident) => incident.status !== "resolved").map((incident) => <IncidentAdminRow incident={incident} reload={load} key={incident.id} />)}</section>
    </div>}
  </Layout>;
}

function IncidentAdminRow({ incident, reload }: { incident: IncidentSummary; reload: () => void }) {
  const [message, setMessage] = useState(""); const [status, setStatus] = useState<IncidentSummary["status"]>(incident.status); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await api(`/api/admin/incidents/${incident.id}/updates`, { method: "POST", body: JSON.stringify({ status, message }) }); setMessage(""); reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Update failed."); } finally { setBusy(false); } };
  return <form className="incident-admin-row" onSubmit={(event) => void submit(event)}><div><strong>{incident.title}</strong><span>{incident.latestMessage}</span></div><select aria-label="Incident status" value={status} onChange={(event) => setStatus(event.target.value as IncidentSummary["status"])}><option value="investigating">Investigating</option><option value="identified">Identified</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></select><input aria-label="Customer update" value={message} onChange={(event) => setMessage(event.target.value)} required minLength={3} maxLength={4000} placeholder="Write a customer-facing update" /><button disabled={busy}>Publish</button>{error && <span className="form-error">{error}</span>}</form>;
}

function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  useEffect(() => {
    const label = path.startsWith("/incidents/") ? "Incident" : path.slice(1).replaceAll("-", " ");
    document.title = path === "/" ? "CloseSpan Status" : `${label.charAt(0).toUpperCase()}${label.slice(1)} · CloseSpan Status`;
  }, [path]);
  if (path === "/") return <StatusPage />;
  if (path === "/maintenance") return <MaintenancePage />;
  if (path === "/incidents") return <IncidentsPage />;
  if (path.startsWith("/incidents/")) return <IncidentPage slug={decodeURIComponent(path.slice("/incidents/".length))} />;
  if (path === "/admin") return <AdminPage />;
  return <Layout active="status"><EmptyState title="Page not found" detail="The requested status page does not exist." /></Layout>;
}

createRoot(document.getElementById("root")!).render(<App />);
