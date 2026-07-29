# CloseSpan agent executor

This Worker accepts HMAC-signed, single-run jobs from CloseSpan, queues each job, and creates a fresh Cloudflare Sandbox container. The AI provider key remains in the Worker. GitHub credentials remain in CloseSpan. The sandbox receives only a short-lived repository archive, the approved prompt, and bounded tools.

## Configure

```bash
npm install
npm run types
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put AGENT_EXECUTOR_SHARED_SECRET
```

Use the same high-entropy `AGENT_EXECUTOR_SHARED_SECRET` in the Vercel application. `OPENAI_MODEL` is a non-secret Wrangler variable. Change it in `wrangler.jsonc` only through normal review.

Create the queue named `closespan-agent-runs` before the first deployment, then deploy from this directory with `npx wrangler deploy`. Cloudflare Sandbox Containers require Workers Paid usage.

## Verify

```bash
npm run types
npx tsc --noEmit
npm run check
npm run check:deploy
```

The final dry-run build requires Docker with the Buildx plugin because Wrangler builds the Sandbox container image. A successful TypeScript check alone does not validate the container image.

The executor permits only read-only inspection commands and exact approved validation commands. All agent and validation commands run in a Bubblewrap network namespace. A no-route preflight is fail-closed: if the deployed container runtime cannot create that namespace, the run fails before repository code executes. It also rejects protected/out-of-scope files, binary or oversized diffs, changed prompt bytes, incomplete criteria, and failed commands before returning evidence to CloseSpan.
