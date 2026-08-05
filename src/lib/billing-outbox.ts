import type { PoolClient } from "pg";
import {
  BillingProviderError,
  createFlexpriceBillingProvider,
  flexpriceShadowConfiguration,
  type BillingPropertyValue,
  type BillingProvider,
} from "./billing-provider";
import { databasePool, transaction } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

export const BILLING_EVENT_NAMES = {
  feedbackProcessed: "feedback.processed",
  aiTokens: "ai.tokens",
  userStoryTestCompleted: "user_story_test.completed",
  agentRunCompleted: "agent_run.completed",
} as const;

export interface BillingUsageEventInput {
  orgId: string;
  eventId: string;
  eventName: (typeof BILLING_EVENT_NAMES)[keyof typeof BILLING_EVENT_NAMES];
  source: string;
  properties: Record<string, BillingPropertyValue>;
  occurredAt?: Date | string;
}

interface BillingCustomerRow {
  org_id: string;
  external_customer_id: string;
  provider_customer_id: string | null;
  attempts: number;
  organization_name: string;
}

interface BillingEventRow {
  id: string;
  org_id: string;
  external_customer_id: string;
  event_id: string;
  event_name: string;
  source: string;
  properties: Record<string, BillingPropertyValue>;
  occurred_at: Date;
  attempts: number;
}

interface BillingCustomerStatusRow {
  status: BillingShadowStatus["customerStatus"];
  metering_enabled: boolean;
  last_error: string | null;
}

interface BillingEventStatusRow {
  pending: number;
  sent: number;
  failed: number;
  last_sent_at: Date | null;
}

export interface BillingShadowDeliveryResult {
  enabled: boolean;
  configured: boolean;
  customersProvisioned: number;
  eventsAccepted: number;
  retried: number;
  failed: number;
}

export interface BillingShadowStatus {
  enabled: boolean;
  configured: boolean;
  provider: "Flexprice";
  mode: "Excluded" | "Local ledger" | "Shadow delivery";
  meteringEnabled: boolean;
  customerStatus: "Not applicable" | "Pending" | "Provisioning" | "Provisioned" | "Failed";
  customerLastError: string | null;
  pendingEvents: number;
  acceptedEvents: number;
  failedEvents: number;
  lastAcceptedAt: string | null;
  configurationIssue: string | null;
}

function occurredAt(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) throw new Error("Billing event timestamp is invalid");
  return date.toISOString();
}

function isMissingBillingSchema(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01",
  );
}

export async function enqueueBillingUsageEvent(
  client: Pick<PoolClient, "query">,
  input: BillingUsageEventInput,
): Promise<boolean> {
  const eventId = input.eventId.trim();
  if (!eventId || eventId.length > 500)
    throw new Error("Billing event ID must be between 1 and 500 characters");
  try {
    const result = await client.query(
      `INSERT INTO billing_event_outbox(
         org_id,provider,event_id,event_name,source,properties,occurred_at
       )
       SELECT $1,'flexprice',$2,$3,$4,$5::jsonb,$6
         FROM billing_customers customer
        WHERE customer.org_id=$1 AND customer.metering_enabled=true
       ON CONFLICT(provider,event_id) DO NOTHING`,
      [
        input.orgId,
        eventId,
        input.eventName,
        input.source,
        JSON.stringify(input.properties),
        occurredAt(input.occurredAt),
      ],
    );
    return result.rowCount === 1;
  } catch (error) {
    // Billing is observational during rollout. Application transactions must
    // remain safe if code reaches an instance before migration 032 does.
    if (isMissingBillingSchema(error)) return false;
    throw error;
  }
}

async function claimCustomer(client: PoolClient): Promise<BillingCustomerRow | null> {
  const result = await client.query<BillingCustomerRow>(
    `WITH candidate AS (
       SELECT customer.org_id,organization.name AS organization_name
         FROM billing_customers customer
         JOIN organizations organization ON organization.id=customer.org_id
        WHERE customer.metering_enabled=true
          AND customer.attempts<8
          AND (
            (customer.status='Pending' AND customer.next_attempt_at<=now())
            OR (customer.status='Provisioning'
                AND customer.updated_at<now()-interval '5 minutes')
          )
        ORDER BY customer.next_attempt_at,customer.created_at,customer.org_id
        LIMIT 1 FOR UPDATE OF customer SKIP LOCKED
     )
     UPDATE billing_customers customer
        SET status='Provisioning',attempts=customer.attempts+1,updated_at=now()
       FROM candidate
      WHERE customer.org_id=candidate.org_id
     RETURNING customer.org_id,customer.external_customer_id,
               customer.provider_customer_id,customer.attempts,
               candidate.organization_name`,
  );
  return result.rows[0] ?? null;
}

async function claimEvent(client: PoolClient): Promise<BillingEventRow | null> {
  const result = await client.query<BillingEventRow>(
    `WITH candidate AS (
       SELECT outbox.id,customer.external_customer_id
         FROM billing_event_outbox outbox
         JOIN billing_customers customer ON customer.org_id=outbox.org_id
           AND customer.provider=outbox.provider
        WHERE customer.metering_enabled=true
          AND customer.status='Provisioned' AND outbox.attempts<8
          AND (
            (outbox.status='Pending' AND outbox.next_attempt_at<=now())
            OR (outbox.status='Sending'
                AND outbox.updated_at<now()-interval '5 minutes')
          )
        ORDER BY outbox.next_attempt_at,outbox.created_at,outbox.id
        LIMIT 1 FOR UPDATE OF outbox SKIP LOCKED
     )
     UPDATE billing_event_outbox outbox
        SET status='Sending',attempts=outbox.attempts+1,updated_at=now()
       FROM candidate
      WHERE outbox.id=candidate.id
     RETURNING outbox.*,candidate.external_customer_id`,
  );
  return result.rows[0] ?? null;
}

function failure(error: unknown, attempts: number): {
  status: "Pending" | "Failed";
  message: string;
  retrySeconds: number;
} {
  const retryable =
    !(error instanceof BillingProviderError) || error.retryable;
  const terminal = !retryable || attempts >= 8;
  const exponentialSeconds = Math.min(
    60 * 2 ** Math.max(attempts - 1, 0),
    3_600,
  );
  const providerSeconds = error instanceof BillingProviderError && error.retryAfterMs
    ? Math.min(Math.ceil(error.retryAfterMs / 1_000), 86_400)
    : 0;
  return {
    status: terminal ? "Failed" : "Pending",
    message: error instanceof Error ? error.message.slice(0, 1_000) : "Billing provider request failed",
    retrySeconds: terminal
      ? 0
      : Math.max(exponentialSeconds, providerSeconds),
  };
}

async function markCustomerProvisioned(
  customer: BillingCustomerRow,
  providerCustomerId: string | null,
): Promise<boolean> {
  const result = await databasePool().query(
    `UPDATE billing_customers
        SET status='Provisioned',provider_customer_id=coalesce($2,provider_customer_id),
            last_error=NULL,synced_at=now(),updated_at=now()
      WHERE org_id=$1 AND status='Provisioning' AND attempts=$3`,
    [customer.org_id, providerCustomerId, customer.attempts],
  );
  return result.rowCount === 1;
}

async function markCustomerFailure(
  customer: BillingCustomerRow,
  error: unknown,
): Promise<"Pending" | "Failed" | null> {
  const outcome = failure(error, customer.attempts);
  const result = await databasePool().query(
    `UPDATE billing_customers
        SET status=$2,last_error=$3,
            next_attempt_at=CASE WHEN $2='Pending'
              THEN now()+($4::int*interval '1 second') ELSE next_attempt_at END,
            updated_at=now()
      WHERE org_id=$1 AND status='Provisioning' AND attempts=$5`,
    [
      customer.org_id,
      outcome.status,
      outcome.message,
      outcome.retrySeconds,
      customer.attempts,
    ],
  );
  return result.rowCount === 1 ? outcome.status : null;
}

async function markEventSent(
  event: BillingEventRow,
  providerEventId: string | null,
): Promise<boolean> {
  const result = await databasePool().query(
    `UPDATE billing_event_outbox
        SET status='Sent',provider_event_id=coalesce($2,provider_event_id),
            last_error=NULL,sent_at=now(),updated_at=now()
      WHERE id=$1 AND status='Sending' AND attempts=$3`,
    [event.id, providerEventId, event.attempts],
  );
  return result.rowCount === 1;
}

async function markEventFailure(
  event: BillingEventRow,
  error: unknown,
): Promise<"Pending" | "Failed" | null> {
  const outcome = failure(error, event.attempts);
  const result = await databasePool().query(
    `UPDATE billing_event_outbox
        SET status=$2,last_error=$3,
            next_attempt_at=CASE WHEN $2='Pending'
              THEN now()+($4::int*interval '1 second') ELSE next_attempt_at END,
            updated_at=now()
      WHERE id=$1 AND status='Sending' AND attempts=$5`,
    [event.id, outcome.status, outcome.message, outcome.retrySeconds, event.attempts],
  );
  return result.rowCount === 1 ? outcome.status : null;
}

function isProviderWideFailure(error: unknown): boolean {
  return error instanceof BillingProviderError &&
    (error.status === 401 || error.status === 403);
}

export async function deliverBillingShadow(
  options: {
    provider?: BillingProvider | null;
    customerLimit?: number;
    eventLimit?: number;
    maxDurationMs?: number;
  } = {},
): Promise<BillingShadowDeliveryResult> {
  const configuration = flexpriceShadowConfiguration();
  const provider = options.provider === undefined
    ? createFlexpriceBillingProvider()
    : options.provider;
  const result: BillingShadowDeliveryResult = {
    enabled: configuration.enabled || Boolean(options.provider),
    configured: Boolean(provider),
    customersProvisioned: 0,
    eventsAccepted: 0,
    retried: 0,
    failed: 0,
  };
  if (!provider) return result;
  const maxDurationMs = Math.min(
    Math.max(options.maxDurationMs ?? 60_000, 1_000),
    120_000,
  );
  const deadline = Date.now() + maxDurationMs;
  let providerUnavailable = false;

  const customerLimit = Math.min(Math.max(options.customerLimit ?? 10, 1), 50);
  for (let index = 0; index < customerLimit; index += 1) {
    if (Date.now() >= deadline) break;
    const customer = await transaction(claimCustomer);
    if (!customer) break;
    try {
      const delivery = await provider.provisionCustomer({
        externalCustomerId: customer.external_customer_id,
        name: customer.organization_name,
        metadata: { closespan_org_id: customer.org_id, mode: "shadow" },
      });
      if (await markCustomerProvisioned(customer, delivery.providerId))
        result.customersProvisioned += 1;
    } catch (error) {
      const status = await markCustomerFailure(customer, error);
      if (status === "Failed") result.failed += 1;
      else if (status === "Pending") result.retried += 1;
      if (isProviderWideFailure(error)) {
        providerUnavailable = true;
        break;
      }
    }
  }

  const eventLimit = Math.min(Math.max(options.eventLimit ?? 50, 1), 200);
  for (let index = 0; !providerUnavailable && index < eventLimit; index += 1) {
    if (Date.now() >= deadline) break;
    const event = await transaction(claimEvent);
    if (!event) break;
    try {
      const delivery = await provider.publishUsage({
        eventId: event.event_id,
        eventName: event.event_name,
        externalCustomerId: event.external_customer_id,
        source: event.source,
        properties: event.properties,
        occurredAt: event.occurred_at.toISOString(),
      });
      if (await markEventSent(event, delivery.providerId))
        result.eventsAccepted += 1;
    } catch (error) {
      const status = await markEventFailure(event, error);
      if (status === "Failed") result.failed += 1;
      else if (status === "Pending") result.retried += 1;
      if (isProviderWideFailure(error)) break;
    }
  }
  return result;
}

export async function getBillingShadowStatus(
  orgId: string,
): Promise<BillingShadowStatus> {
  const configuration = flexpriceShadowConfiguration();
  const base: BillingShadowStatus = {
    enabled: configuration.enabled,
    configured: configuration.configured,
    provider: "Flexprice",
    mode: configuration.enabled ? "Shadow delivery" : "Local ledger",
    meteringEnabled: true,
    customerStatus: "Not applicable",
    customerLastError: null,
    pendingEvents: 0,
    acceptedEvents: 0,
    failedEvents: 0,
    lastAcceptedAt: null,
    configurationIssue: configuration.reason,
  };
  if (workspacePersistenceMode(orgId) !== "postgres") {
    return {
      ...base,
      mode: "Excluded",
      meteringEnabled: false,
      configurationIssue: "Memory and simulated workspaces are excluded from billing metering",
    };
  }

  let customerRows: BillingCustomerStatusRow[];
  let eventRows: BillingEventStatusRow[];
  try {
    const [customer, events] = await Promise.all([
      databasePool().query<BillingCustomerStatusRow>(
        `SELECT status,metering_enabled,last_error
           FROM billing_customers WHERE org_id=$1`,
        [orgId],
      ),
      databasePool().query<BillingEventStatusRow>(
        `SELECT
           count(*) FILTER (WHERE status IN ('Pending','Sending'))::int AS pending,
           count(*) FILTER (WHERE status='Sent')::int AS sent,
           count(*) FILTER (WHERE status='Failed')::int AS failed,
           max(sent_at) AS last_sent_at
         FROM billing_event_outbox WHERE org_id=$1`,
        [orgId],
      ),
    ]);
    customerRows = customer.rows;
    eventRows = events.rows;
  } catch (error) {
    if (!isMissingBillingSchema(error)) throw error;
    return {
      ...base,
      configured: false,
      configurationIssue: "Billing migration 032 is pending",
    };
  }
  const customerRow = customerRows[0];
  if (customerRow && !customerRow.metering_enabled) {
    return {
      ...base,
      mode: "Excluded",
      meteringEnabled: false,
      customerStatus: "Not applicable",
      configurationIssue: "Simulated workspaces are excluded from billing metering",
    };
  }
  const counts = eventRows[0];
  return {
    ...base,
    customerStatus: customerRow?.status ?? "Pending",
    customerLastError: customerRow?.last_error ?? null,
    pendingEvents: counts?.pending ?? 0,
    acceptedEvents: counts?.sent ?? 0,
    failedEvents: counts?.failed ?? 0,
    lastAcceptedAt: counts?.last_sent_at?.toISOString?.() ?? null,
  };
}

export async function requeueFailedBillingShadow(
  orgId: string,
): Promise<{ customersRequeued: number; eventsRequeued: number }> {
  if (workspacePersistenceMode(orgId) !== "postgres")
    return { customersRequeued: 0, eventsRequeued: 0 };
  try {
    return await transaction(async (client) => {
      const customers = await client.query(
        `UPDATE billing_customers
            SET status='Pending',attempts=0,next_attempt_at=now(),last_error=NULL,
                updated_at=now()
          WHERE org_id=$1 AND metering_enabled=true AND status='Failed'`,
        [orgId],
      );
      const events = await client.query(
        `UPDATE billing_event_outbox
            SET status='Pending',attempts=0,next_attempt_at=now(),last_error=NULL,
                updated_at=now()
          WHERE org_id=$1 AND status='Failed'`,
        [orgId],
      );
      return {
        customersRequeued: customers.rowCount ?? 0,
        eventsRequeued: events.rowCount ?? 0,
      };
    });
  } catch (error) {
    if (isMissingBillingSchema(error))
      return { customersRequeued: 0, eventsRequeued: 0 };
    throw error;
  }
}
