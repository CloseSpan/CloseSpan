UPDATE services
SET name = 'Core API',
    description = 'CloseSpan production API availability and runtime health.',
    updated_at = unixepoch() * 1000
WHERE id = 'svc_api';

INSERT OR IGNORE INTO services (
  id, slug, name, description, sort_order, probe_kind, probe_url, expected_text,
  probe_interval_minutes, latency_threshold_ms, created_at, updated_at
) VALUES (
  'svc_database',
  'neon-database',
  'Neon database',
  'Primary Neon PostgreSQL connectivity and query execution.',
  35,
  'api',
  'https://www.closespan.com/api/health',
  NULL,
  1,
  2500,
  unixepoch() * 1000,
  unixepoch() * 1000
);
