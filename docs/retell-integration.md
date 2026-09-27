# Retell AI call intake

Retell is a native, read-only feedback connector in **Integrations → Retell AI**. This is an application integration, not a change to a developer’s Codex MCP configuration.

## Setup

An administrator in a live workspace can connect a Retell API key. The existing Postgres schema and `AI_CREDENTIAL_ENCRYPTION_KEY` vault are required; no new migration is necessary. Credentials use the existing encrypted integration-secret table, authenticated to the organization and `int_retell` provider. Keys never return to the browser.

“Import recent calls” checks the latest 25 calls via Retell’s `POST /v3/list-calls`. Only ended calls with post-call analysis and nonempty text are imported. This is not a full historical backfill. A specific older call can be imported by its Retell call ID.

For automatic intake, add the displayed URL to Retell’s webhook settings for `call_analyzed`. Use the Retell API key marked **webhook** for signature verification. The URL must be publicly reachable over HTTPS; Retell cannot deliver to localhost. No webhook is registered in Retell automatically.

## Data and processing

- Import only summary, transcript excerpt, call ID, and call date. Phone-number fields, recordings, dynamic variables, and arbitrary metadata are not persisted.
- Existing redaction masks email addresses, phone-like sequences, and labeled secrets. It is best-effort, not a guarantee that transcripts contain no personal data. Text is capped at 8,000 characters, with up to 2,000 characters allocated to the summary and 5,900 to the transcript. Longer transcripts are explicitly labeled as excerpts.
- Calls enter the existing Feedback inbox under **Retell AI**, with zero classification confidence until analyzed. Retell’s summary is supporting evidence, not confirmation of a bug.
- After import, the existing AI classification/clustering pipeline processes pending Retell feedback if workspace AI credentials and budget permit. No coding run, external notification, outbound call, or agent edit is started by these routes. If analysis fails, the persisted feedback can be retried by importing again or analyzed from the inbox.
- Repeated imports and webhook deliveries deduplicate by organization, integration, source namespace, and call ID. Existing reviewed feedback is not overwritten.
- Disconnect removes the stored key and disables intake; previously imported feedback remains. Reconnecting issues a new webhook URL, invalidating the previous endpoint.

## MCP boundary

Specific-call import first connects to `https://mcp.retellai.com` using bearer authentication and discovers tools. Only exact names `get_call`, `getCall`, or `retrieve_call` with a compatible `call_id` input are allowed. The full catalog is never exposed to an LLM. Unknown tools, unsupported schemas, invalid content, and unavailable MCP fall back to Retell’s fixed `GET /v2/get-call/{call_id}` endpoint. A successful API fallback is not proof of an authenticated MCP connection.

## Verification

Mocked tests cover request authorization, demo read-only enforcement, tenant boundaries, encrypted credentials, raw-body HMAC and timestamp validation, input limits, deduplication, disconnect races, provider-error sanitization, and the MCP read allowlist. Real Retell authentication, MCP tool discovery, and live webhook delivery require an authorized account and a public callback URL; local tests do not claim to verify those.

References: [MCP server](https://docs.retellai.com/get-started/mcp-server), [list calls](https://docs.retellai.com/api-references/list-calls), [get call](https://docs.retellai.com/api-references/get-call), [webhook security](https://docs.retellai.com/features/secure-webhook), [post-call analysis](https://docs.retellai.com/features/post-call-analysis-consumption).
