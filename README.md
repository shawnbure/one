# Workrr One

Workrr is a Cloudflare-native private AI operations framework for mid-market organizations without an internal AI engineering team. It packages repeatable AI processes, durable conversations, human approvals, and operational visibility into a customer-owned deployment.

## What is implemented

- A polished React operations console with process discovery, Process Studio, Work Inbox, execution activity, governance, team roles, API logs, model profiles, and value reporting.
- A Cloudflare Worker API with verified tenant and role context, immutable releases, execution history and replay, approvals, audit evidence, operating controls, and deployment exports.
- Cloudflare Agents SDK durable actors with local SQLite conversation history and immutable prompt-release bundles.
- Explicit routing for `conversation`, `consumer`, `entity`, `shared_shard`, `temporary_durable`, `instant`, and `workflow` execution profiles.
- Workers AI model profiles with Agent `sessionAffinity` for prefix-cache locality on repeated durable conversations.
- D1 control-plane schema for tenants, memberships, blueprints, opportunity baselines, prompt releases, executions, approvals, webhooks, API logs, and audit events.
- Cloudflare Queues with retries and a DLQ, Workflows with retryable durable steps, and Cron maintenance wiring.
- Signed, idempotent webhook ingestion with a bounded request body and queue handoff.
- HMAC-signed outbound webhook notifications with public-destination validation, Queue retries, delivery testing, and persisted attempt evidence.
- Tenant-scoped credential references whose values remain in Cloudflare secrets rather than D1, exports, logs, or browser bundles.
- An idempotent customer launch package that establishes branding, membership, a paused first process, discovery baseline, evaluation gate, and immutable draft release without duplicating records on retry.
- A release quality lab with curated golden cases, expected/prohibited output assertions, exact-release Workers AI runs, weighted scoring, release comparison, and token/cost evidence.
- Durable Cloudflare Workflow evaluation suites with human scorecards and explicit promotion of stored, truncated production previews into regression cases.
- Isolated baseline-versus-candidate Cloudflare model trials with quality/cost recommendations and automatic masking of common sensitive patterns before case persistence.
- Cloudflare Access JWT verification, server-derived tenant membership, role-based authorization, and same-origin browser mutations.
- Shared typed contracts and tests for sticky identity routing.

## Architecture boundary

D1 is the source of truth for published process and prompt releases. A durable Agent checks whether its configured release is already installed; D1 is read only when a new release must be copied into that actor's local SQLite database. Later turns use the local copy. The stable Agent identity is also passed to Workers AI as `sessionAffinity`, allowing Cloudflare's model infrastructure to improve prefix-cache locality without KV.

Instant executions deliberately have no durable identity and load their release from D1. Workflow executions use Cloudflare Workflows for retryable, long-lived orchestration. Queues absorb independent bursts; they are not used as a substitute for ordered actor state.

## Local development

Requirements: Node.js 22+, a Cloudflare account, and Wrangler authentication for live Workers AI calls.

```bash
npm install
npm run cf:types
npm run db:migrate:local -w @workrr/platform-worker
npm run dev:worker
```

In a second terminal:

```bash
npm run dev
```

The admin runs at `http://localhost:5173` and proxies `/api` to the Worker on port 8787. Development mode supplies the seeded `demo` tenant and local admin identity. Production does not accept that fallback.

## Provision and deploy

Create the resources once per customer environment:

```bash
npx wrangler d1 create workrr-platform
npx wrangler queues create workrr-process-jobs
npx wrangler queues create workrr-process-jobs-dlq
```

Copy the returned D1 ID into `apps/platform-worker/wrangler.jsonc`, then run:

```bash
npm run db:migrate:remote -w @workrr/platform-worker
npm run deploy -w @workrr/platform-worker
npm run build -w @workrr/admin
```

The admin build is served by the same Worker through Workers Static Assets. API and health paths run through the Worker first; browser routes use the SPA fallback.

## Recommended Git deployment policy

Use Cloudflare Workers Builds rather than a GitHub Actions deployment workflow:

- `main` is the production branch and may promote an active deployment.
- `dev` deploys the isolated development Worker; `main` deploys the production Worker.
- Other branches do not trigger Cloudflare builds, avoiding duplicate preview usage while the product is under active development.
- Require the typecheck, test, build, and Cloudflare preview checks before merging into `main`.
- Configure build watch paths so documentation-only commits do not consume build minutes.
- Keep D1 migrations as an explicit reviewed release step; do not run production migrations automatically on every branch push.

Suggested Workers Builds settings for this monorepo:

```text
Root directory: /
Build command: npm ci && npm run typecheck && npm test && npm run build -w @workrr/admin
Production deploy command: npm run deploy -w @workrr/platform-worker
Production branch: main for `workrr-platform`; dev for `workrr-platform-dev`
Non-production branch builds: disabled on both Workers
```

The Cloudflare account is pinned by `account_id` in the Wrangler configuration. The account ID is an identifier, not a credential; authentication remains in Wrangler locally or in the Cloudflare-managed build token.

## Security gate before production

The development domain is protected by Cloudflare Access and the Worker verifies the signed Access JWT against the application's audience before mapping the email to a D1 tenant membership. Tenant and role are derived server-side. Browser mutations enforce same-origin requests; arbitrary CORS is not enabled. The local development environment retains a development-only identity fallback.

Production remains closed until its own Access application, audience, allow policy, and membership records are explicitly configured. Never reuse a development audience for production.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The broader product and build sequence are documented in:

- `docs/mvp-build-status.md`
- `docs/cloudflare-agent-framework-technical-outline.md`
- `docs/cloudflare-agent-framework-deep-review.md`
- `docs/mid-market-private-ai-product-requirements.md`
