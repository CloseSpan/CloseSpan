# Flexprice shadow metering

CloseSpan records billing evidence in PostgreSQL before sending anything to a
billing provider. Flexprice is an asynchronous projection during shadow mode;
it does not charge customers, create subscriptions, or enforce entitlements.

## Durable boundary

Migration `032_billing_shadow_metering.sql` creates:

- `billing_customers`, keyed by the CloseSpan organization ID;
- `billing_event_outbox`, the idempotent local usage ledger;
- an organization trigger that provisions or refreshes the provider customer;
- a feedback trigger that records exactly one `feedback.processed` event after
  PostgreSQL accepts a new feedback row.

Seeded and simulated workspaces are explicitly marked ineligible. Their
feedback and internal agent activity never enter the billing ledger or leave
CloseSpan. New production organizations are eligible by default.

The feedback trigger deliberately excludes quotes, customer names, and other
feedback content. It records only the feedback ID, source, integration ID, and
quantity.

Shadow customer records contain the organization ID and organization name.
CloseSpan does not send an arbitrary workspace administrator email. Customer
creation also disables Flexprice onboarding workflows so metering cannot
trigger customer communication or downstream onboarding automation.

Application transactions also record internal cost telemetry for successful AI
analysis, PDD user-story verification, and Tenki agent-run completion. These
events are observational and must not become customer-facing prices without a
separate packaging decision.

## Flexprice setup

Create sandbox features whose event names exactly match:

- `feedback.processed` — Count aggregation;
- `ai.tokens` — Sum `total_tokens` for internal cost reporting;
- `user_story_test.completed` — Count aggregation;
- `agent_run.completed` — Count aggregation; `duration_seconds` is available for
  internal compute analysis.

Then configure the server runtime:

```dotenv
FLEXPRICE_SHADOW_ENABLED=true
FLEXPRICE_API_KEY=<server-only sandbox key>
FLEXPRICE_API_BASE_URL=https://us.api.flexprice.io/v1
FLEXPRICE_TIMEOUT_MS=10000
```

Use the base URL assigned to the Flexprice account region. Never expose the API
key through a `NEXT_PUBLIC_` variable.

## Delivery and failure behavior

The existing authenticated Cloudflare scheduler invokes the workflow automation
endpoint every minute. A bounded dispatcher:

1. claims work with `FOR UPDATE SKIP LOCKED`;
2. upserts customers by `external_customer_id = organization.id`;
3. sends usage with the same deterministic `event_id` on every retry;
4. retries network failures, conflicts, rate limits, and provider 5xx errors;
5. permanently records non-retryable provider failures;
6. records provider acceptance separately from later billing reconciliation;
7. recovers claims abandoned for more than five minutes.

Delivery runs after the core Slack and problem-automation work, uses a small
batch, and has a strict route budget. A slow or unavailable billing provider
cannot delay the customer workflow. Claim completion uses the claimed attempt
number as a compare-and-set token, so a stale worker cannot overwrite a newer
success or an organization rename.

Authentication errors stop the current provider batch instead of poisoning
every queued workspace. Failed customer or event delivery is visible in
Settings. After correcting credentials or meter configuration, a workspace
administrator can explicitly requeue failed delivery from **Plan & billing**.

Migration 032 should still be applied before the application deployment. The
application treats an absent billing table as a pending rollout and does not
roll back AI, PDD, or agent-run completion if an instance receives traffic
during a rolling deploy.

Provider failure never rolls back ingestion, AI results, PDD verification, or
Tenki results. Settings shows real local queued, provider-accepted, and failed
totals. A Flexprice `202` response is acceptance, not proof that a configured
meter rated the event.

## Promotion criteria

Keep shadow mode non-enforcing until at least one complete billing period has
been reconciled between the CloseSpan ledger and Flexprice. Enabling plans,
invoices, credits, Stripe synchronization, or entitlement gates requires a
separate reviewed rollout.
