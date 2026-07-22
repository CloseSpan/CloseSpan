# ADR-001: Prove the workflow in a modular monolith

- Status: Accepted for MVP
- Date: 2026-07-15

## Context

CloseSpan ultimately needs asynchronous ingestion, PostgreSQL/pgvector, Redis-backed jobs, secure connector services, and isolated AI execution. Building all services before validating the approval-led problem workflow would create operational complexity without reducing the main product risk: whether users trust the clustering, prioritization, investigation, and action evidence.

## Decision

The first usable version is a strict-TypeScript Next.js modular monolith. Domain logic is framework-independent. External interactions sit behind route and adapter boundaries. All demo integration behavior is deterministic and labeled simulated. No production credentials are accepted.

## Consequences

Local setup remains one command and the full product loop can be tested synchronously. Process-local state is not production-ready, so authentication, PostgreSQL persistence, webhook ingestion, and workers are mandatory before real customer data. The extraction boundary is domain services and integration adapters rather than UI components.
