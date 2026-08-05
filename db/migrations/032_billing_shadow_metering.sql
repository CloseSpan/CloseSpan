CREATE TABLE IF NOT EXISTS billing_customers (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'flexprice'
    CHECK (provider IN ('flexprice')),
  external_customer_id text NOT NULL,
  provider_customer_id text,
  metering_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Provisioning','Provisioned','Failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,external_customer_id)
);

INSERT INTO billing_customers(
  org_id,provider,external_customer_id,metering_enabled
)
SELECT organization.id,'flexprice',organization.id,
       NOT (
         organization.id='org_northstar'
         OR EXISTS (
           SELECT 1 FROM workspace_settings settings
            WHERE settings.org_id=organization.id
              AND (
                settings.plan_name='Sandbox'
                OR settings.plan_name ILIKE '%demo%'
              )
         )
       )
  FROM organizations organization
ON CONFLICT (org_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS billing_customers_delivery_idx
  ON billing_customers(status,next_attempt_at,created_at)
  WHERE status IN ('Pending','Provisioning');

CREATE TABLE IF NOT EXISTS billing_event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'flexprice'
    CHECK (provider IN ('flexprice')),
  event_id text NOT NULL,
  event_name text NOT NULL,
  source text NOT NULL DEFAULT 'closespan',
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Sending','Sent','Failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_event_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,event_id)
);

CREATE INDEX IF NOT EXISTS billing_event_outbox_delivery_idx
  ON billing_event_outbox(status,next_attempt_at,created_at)
  WHERE status IN ('Pending','Sending');

CREATE INDEX IF NOT EXISTS billing_event_outbox_org_status_idx
  ON billing_event_outbox(org_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION provision_billing_shadow_customer()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO billing_customers(org_id,provider,external_customer_id)
  VALUES(NEW.id,'flexprice',NEW.id)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS organizations_provision_billing_shadow_customer
  ON organizations;
CREATE TRIGGER organizations_provision_billing_shadow_customer
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION provision_billing_shadow_customer();

CREATE OR REPLACE FUNCTION refresh_billing_shadow_customer()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE billing_customers
       SET status='Pending',attempts=0,next_attempt_at=now(),last_error=NULL,
           updated_at=now()
     WHERE org_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS organizations_refresh_billing_shadow_customer
  ON organizations;
CREATE TRIGGER organizations_refresh_billing_shadow_customer
AFTER UPDATE OF name ON organizations
FOR EACH ROW EXECUTE FUNCTION refresh_billing_shadow_customer();

CREATE OR REPLACE FUNCTION enqueue_feedback_processed_billing_event()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO billing_event_outbox(
    org_id,provider,event_id,event_name,source,properties,occurred_at
  )
  SELECT
    NEW.org_id,
    'flexprice',
    'feedback.processed:' || NEW.org_id || ':' || NEW.id,
    'feedback.processed',
    'closespan.feedback',
    jsonb_build_object(
      'quantity',1,
      'feedback_id',NEW.id,
      'source',NEW.source,
      'integration_id',NEW.integration_id,
      'source_namespace',NEW.source_namespace
    ),
    COALESCE(NEW.created_at,now())
  FROM billing_customers customer
  WHERE customer.org_id=NEW.org_id
    AND customer.metering_enabled=true
  ON CONFLICT (provider,event_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS feedback_items_enqueue_billing_event ON feedback_items;
CREATE TRIGGER feedback_items_enqueue_billing_event
AFTER INSERT ON feedback_items
FOR EACH ROW EXECUTE FUNCTION enqueue_feedback_processed_billing_event();
