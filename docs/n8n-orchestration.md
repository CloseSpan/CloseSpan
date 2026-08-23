# n8n orchestration

CloseSpan can route connected-source collection jobs through either Pipedream
or n8n. The selection is workspace-specific and reversible. Switching does not
remove accounts, credentials, imported feedback, or source history from either
provider.

## Configure the n8n workflow

1. Create a production webhook in n8n and configure it to accept `POST`.
2. Add a first branch for `event === "connection.test"`. Verify the signature,
   return HTTP 2xx, and do not import data when `dryRun` is `true`.
3. Add the collection branch for `event === "feedback.pull.requested"`.
4. Read `selection.integrationIds` and `selection.accountIds` when `mode` is
   `selected`; otherwise collect all sources configured in the workflow.
5. Send normalized feedback to the CloseSpan Custom webhook associated with the
   workspace. Use a stable upstream message ID as
   `x-closespan-delivery-id` so retries remain idempotent.
6. Return HTTP 2xx promptly. The optional JSON response can include
   `executionId`, `runUrl`, and `message` for the CloseSpan status notice.

### Discord workflow test

Use `int_discord` as the selected integration ID when testing Discord through
n8n. The workflow should use its own Discord credential to read the selected
server or channel, normalize each message, and return it through the CloseSpan
Custom webhook. A selected request has this shape:

```json
{
  "event": "feedback.pull.requested",
  "selection": {
    "mode": "selected",
    "integrationIds": ["int_discord"],
    "accountIds": ["<discord-guild-id>"]
  }
}
```

This n8n route is independent of CloseSpan's direct Discord gateway intake.
Turning n8n on does not remove or overwrite the existing Discord installation.

CloseSpan signs the exact UTF-8 request body with HMAC-SHA256 using the
workspace signing secret and sends the digest as:

```text
x-closespan-signature: sha256=<hex digest>
```

The n8n workflow must calculate the same digest before trusting a request.
Never log or return the signing secret.

## Activate n8n

In **Settings → Workflow orchestration**, select **n8n** and enter:

- the n8n instance base URL;
- the production webhook URL on that same origin;
- an n8n API key; and
- a long webhook signing secret.

CloseSpan checks the n8n API with the `X-N8N-API-KEY` header, then sends a
signed `connection.test` dry run to the production webhook. n8n is activated
only after both checks return successfully.

## Roll back to Pipedream

Select **Pipedream** in the same setting. Stored n8n configuration remains
available for later performance comparison, and existing Pipedream accounts do
not need to be reconnected.
