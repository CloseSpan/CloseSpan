# Production architecture and migration path

## MVP boundary

The current slice optimizes for the trust loop: corroborated signals become one explainable problem; a repository-aware recommendation remains explicitly uncertain; a human approves any external action; every transition is audited. It does not pretend simulated connectors are live.

## Target services

1. **Web application:** Next.js, strict TypeScript, accessible primitives, TanStack Query, server-side organization context.
2. **Domain API:** FastAPI, Pydantic and SQLAlchemy. PostgreSQL row-level security provides defense-in-depth tenant isolation; every primary and join record includes `organization_id`.
3. **Ingestion gateway:** validates webhook signatures, records an immutable delivery envelope, deduplicates on `(integration_id, provider_delivery_id)`, acknowledges quickly, and queues normalization.
4. **Workers:** Redis-backed queues with bounded exponential retries, dead-letter routing, per-tenant rate limits, distributed locks, and idempotent action keys.
5. **Intelligence service:** OpenAI Responses API with versioned prompts and JSON-schema structured outputs. Embeddings live in pgvector. Customer content is quoted as untrusted evidence and never concatenated into system/tool instructions.
6. **Integration adapters:** capability-oriented `health`, `sync`, `fetch`, `createWorkItem`, `updateConversation`, and `revoke` methods. Adapters declare scopes, data shared, idempotency support, reversibility, and rate-limit state.
7. **Object storage:** Alibaba OSS for encrypted attachments with short-lived signed URLs, malware scanning, and retention policies.

## Core persistence invariants

- All records and vector searches are organization-scoped.
- Source feedback preserves an immutable encrypted original and a separately access-controlled redacted representation.
- Cluster memberships retain model run, prompt version, similarity features, human overrides, and evidence.
- Recommendations are immutable snapshots. Approval executes the exact reviewed payload hash; edits produce a new version.
- Agent actions use idempotency keys and record intent, authorization, result, rollback metadata, cost, and trace ID.
- Audit events are append-only and exportable.

## Security and reliability gates before real data

- OIDC authentication, SCIM-ready membership, least-privilege RBAC, and step-up authentication for high-risk approvals.
- OAuth tokens encrypted with envelope keys in KMS-backed secret storage; never returned to the browser or logs.
- Webhook signature and timestamp validation, replay windows, delivery deduplication, retry queues, and DLQ operations.
- PII classification/redaction before model calls; configurable regional retention and verified deletion propagation.
- Strict tool allowlists, egress controls, structured output validation, confidence thresholds, and prompt-injection regression tests.
- OpenTelemetry traces, structured logs with redaction, SLOs for ingestion freshness and action execution, cost budgets, and integration health alerts.
- SOC 2 evidence collection plus GDPR/CCPA access, portability, deletion, and subprocessors workflows.

## Delivery sequence

1. Add PostgreSQL migrations for organizations, users/roles, integrations, customers/accounts, feedback, problems/memberships, impact snapshots, investigations/recommendations, approvals/actions, work items, releases/resolutions, notifications, audit events, model runs, and prompt versions.
2. Add authentication, organization middleware, RBAC policy tests, and row-level-security integration tests.
3. Extract webhook and worker processes; prove duplicate delivery, source update/delete, retry, and DLQ behavior.
4. Integrate GitHub first through a GitHub App with repository allowlists and approval-bound payload hashes.
5. Add one feedback source (Intercom or Zendesk), then Jira/Linear, Slack, and Sentry/PostHog.
6. Add evaluation sets for classification, clustering, severity, and investigation grounding before model changes can ship.

## Integration contract sketch

```ts
interface IntegrationAdapter {
  readonly provider: string;
  capabilities(): CapabilityManifest;
  health(context: TenantContext): Promise<HealthResult>;
  sync(cursor: SyncCursor, context: TenantContext): Promise<SyncPage>;
  normalize(envelope: WebhookEnvelope): Promise<NormalizedEvent[]>;
  execute(action: ApprovedAction, context: TenantContext): Promise<ActionResult>;
}
```

The executor rejects actions whose reviewed payload hash, tenant, connector scopes, expiration, or approval policy no longer match.
