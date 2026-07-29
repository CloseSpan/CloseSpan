PRAGMA foreign_keys = ON;

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  probe_kind TEXT NOT NULL CHECK (probe_kind IN ('text', 'api', 'component', 'executor')),
  probe_url TEXT NOT NULL DEFAULT '',
  expected_text TEXT,
  probe_interval_minutes INTEGER NOT NULL DEFAULT 1 CHECK (probe_interval_minutes BETWEEN 1 AND 60),
  latency_threshold_ms INTEGER NOT NULL DEFAULT 2500 CHECK (latency_threshold_ms BETWEEN 100 AND 60000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  current_status TEXT NOT NULL DEFAULT 'operational' CHECK (current_status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  consecutive_slow INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_response_ms INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  scheduled_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  latency_ms INTEGER,
  maintenance_excluded INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_excluded IN (0, 1)),
  error_code TEXT,
  UNIQUE(service_id, scheduled_at)
);

CREATE INDEX checks_service_time_idx ON checks(service_id, scheduled_at DESC);
CREATE INDEX checks_retention_idx ON checks(checked_at);

CREATE TABLE daily_rollups (
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  total_checks INTEGER NOT NULL,
  successful_checks INTEGER NOT NULL,
  degraded_checks INTEGER NOT NULL,
  failed_checks INTEGER NOT NULL,
  maintenance_checks INTEGER NOT NULL,
  worst_status TEXT NOT NULL CHECK (worst_status IN ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  calculated_at INTEGER NOT NULL,
  PRIMARY KEY(service_id, day)
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('degraded', 'partial_outage', 'major_outage')),
  source TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX incidents_status_time_idx ON incidents(status, created_at DESC);

CREATE TABLE incident_services (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY(incident_id, service_id)
);

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  message TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('automation', 'operator')),
  author_email TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX incident_updates_incident_time_idx ON incident_updates(incident_id, created_at DESC);

CREATE TABLE maintenance_windows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX maintenance_time_idx ON maintenance_windows(starts_at, ends_at);

CREATE TABLE maintenance_services (
  maintenance_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY(maintenance_id, service_id)
);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE(event_key, channel)
);

CREATE INDEX notification_pending_idx ON notification_outbox(state, next_attempt_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO services (
  id, slug, name, description, sort_order, probe_kind, probe_url, expected_text,
  probe_interval_minutes, latency_threshold_ms, created_at, updated_at
) VALUES
  ('svc_website', 'website', 'Website', 'CloseSpan public website and product information.', 10, 'text', '', 'CloseSpan', 1, 2500, unixepoch() * 1000, unixepoch() * 1000),
  ('svc_application', 'application', 'Application', 'CloseSpan sign-in and authenticated application entry point.', 20, 'text', '', 'Sign in', 1, 3000, unixepoch() * 1000, unixepoch() * 1000),
  ('svc_api', 'api-database', 'API & database', 'Core application API and primary database connectivity.', 30, 'api', '', NULL, 1, 2500, unixepoch() * 1000, unixepoch() * 1000),
  ('svc_integrations', 'feedback-integrations', 'Feedback integrations', 'Feedback-source connections and synchronization services.', 40, 'component', '', 'integrations', 5, 4000, unixepoch() * 1000, unixepoch() * 1000),
  ('svc_ai', 'ai-processing', 'AI processing', 'AI analysis and structured feedback processing.', 50, 'component', '', 'ai', 5, 5000, unixepoch() * 1000, unixepoch() * 1000),
  ('svc_agent', 'agent-execution', 'Agent execution', 'Isolated implementation-agent execution infrastructure.', 60, 'executor', '', NULL, 15, 12000, unixepoch() * 1000, unixepoch() * 1000);
