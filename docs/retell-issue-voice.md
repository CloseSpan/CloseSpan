# Retell issue conversations

CloseSpan can host a browser voice conversation about one issue. This is separate from the read-only Retell call-import integration. It does not make phone calls, modify a customer agent, run tests, or approve work.

## Try it

In a live workspace, open **Issues → an issue → Discuss this issue → Talk about this issue**. Starting the conversation asks for microphone access. Mute and End remain available during a call, and each call ends after five minutes at most.

The assistant receives bounded, redacted context from that issue: customer reports, investigation, requirements, recorded results, and recent discussion. It must distinguish reported behavior from verified results. Existing test-result and current preview links appear below the voice controls when available; voice does not create a preview.

Live captions depend on Retell's monitoring availability and fall back to a notice if unavailable. After ending, **Use my notes in chat** copies only the user's spoken words into the existing composer. Review and send the draft to save it. Neither a spoken instruction nor copied notes authorizes coding or merging.

Opening the discussion or voice controls does not start a call; **Start conversation** is the explicit action after the Retell audio/context notice. Collapsing the discussion preserves unsent text and ended-call notes in the current tab. While connecting or live, the panel stays open and exposes **Cancel** or **End**. If adding voice notes would exceed the 2,000-character composer limit, the existing draft remains unchanged and a recovery notice explains how to shorten it or copy a shorter transcript excerpt.

## Configuration

Server-only environment variables:

| Variable | Purpose |
| --- | --- |
| `CLOSESPAN_RETELL_API_KEY` | A dedicated, CloseSpan-owned Retell account key in deployed environments. Never expose it as a public variable. |
| `CLOSESPAN_RETELL_AGENT_ID` | The dedicated discussion-only agent. |
| `CLOSESPAN_RETELL_ALLOWED_ORG_IDS` | Comma-separated workspace IDs allowed to use the service. Empty means disabled. |
| `CLOSESPAN_RETELL_SIGNING_KEY` | At least 32 characters, used for short-lived session tickets. Falls back to `AUTH_SECRET`, then `AI_CREDENTIAL_ENCRYPTION_KEY`. |
| `CLOSESPAN_RETELL_TEST_ORG_ID` | Development only: explicitly approved workspace whose connected Retell key may be used for local testing when no service key is set. Never used in production. |

The app must run with `APP_MODE=production` and PostgreSQL persistence. This is independent of Next.js development/production mode. Presentation-demo workspaces and viewer roles cannot start sessions. The existing `079_issue_conversations.sql` migration is required for text discussion and saved notes; apply it to a remote database only with the owner's permission.

Start only the app for local testing: `npm run dev:app -- --hostname 127.0.0.1 --port 3000`. The regular `npm run dev` command also starts background workflow scheduling.

## Provisioning the local test agent

After explicit account-owner approval, bundle `scripts/setup-issue-voice.ts` with the repository's esbuild and run it with the environment loaded. `--list` lists connected workspace IDs and names, never keys. Creating a separate agent requires both `--org=<approved-workspace-id>` and `--confirm-create-agent`. It creates a dedicated agent/LLM, prints their IDs, and starts no call. Repeating it reuses a matching agent only if its safety settings still pass verification.

The provisioner is intended for owner-approved local testing. Production service-agent provisioning should use a dedicated CloseSpan account, not a customer's call-import credential.

## Boundaries and retention

- Agent settings are verified before each session: fixed prompt, no tools, MCP servers, states, shared knowledge bases, or webhooks; a five-minute maximum.
- Retell stores only basic call attributes, not recordings or transcript content. Audio/context still pass through Retell for real-time processing. Do not claim this is offline or zero processing.
- Captions pass through an authenticated server stream and remain in the browser tab until explicitly sent as chat notes. Provider credentials never reach the browser; only a single-call media token does.
- Context and lifecycle APIs require the current authenticated organization, issue, contributor/admin role, and same-origin mutation checks. Stop/caption requests additionally require a signed, actor/organization/issue-bound ticket.
- Existing audit events and idempotency tables enforce a rolling 24-hour ceiling of 10 starts per member and 40 per workspace, with at most one active conversation per member and three per workspace. Failed creation attempts also consume the daily limit. Creation is never automatically retried.
- The audit trail records session start/end metadata, not speech or audio. Ambiguous disconnects retain the active slot until the short reservation expires. Provider-enforced duration remains the final bound if the browser closes or loses connectivity.

## Verification

The focused voice tests cover authorization, tenant/actor binding, quotas, duplicate starts, agent configuration drift, redaction, provider-error sanitization, and transcript cleanup. The build can be verified with `PERSISTENCE_MODE=memory APP_MODE=demo npm run build` without remote data mutations.

A real conversation is still required to validate microphone permission, network/WebRTC connectivity, voice quality, and Retell live-caption behavior in the user's browser. Automated unit tests do not establish these outcomes.
