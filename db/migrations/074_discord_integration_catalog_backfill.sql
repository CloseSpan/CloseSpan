-- Existing workspaces predate the native Discord connector. Backfill its
-- tenant-owned catalog row so they receive the same onboarding and Integrations
-- experience as newly created workspaces.
INSERT INTO integrations(
  id,
  org_id,
  provider,
  category,
  connection_state,
  data_scope,
  permissions,
  display_order
)
SELECT
  'int_discord',
  organizations.id,
  'Discord',
  'Feedback',
  'Not connected',
  'None',
  '[]'::jsonb,
  4
FROM organizations
ON CONFLICT DO NOTHING;
