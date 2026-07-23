# Workrr One

Workrr is a Cloudflare-native private AI operations framework for mid-market organizations without an internal AI engineering team. It packages repeatable AI processes, durable conversations, human approvals, and operational visibility into a customer-owned deployment.

## What is implemented

- A polished React operations console with process discovery, Process Studio, Work Inbox, execution activity, governance, team roles, API logs, model profiles, and value reporting.
- A Cloudflare Worker API with verified tenant and role context, immutable releases, execution history and replay, deterministic “why did this happen?” explanations, redacted evidence exports, approvals, audit evidence, operating controls, and deployment exports.
- Evidence-backed deployment verification that requires an active Access operator service principal and a recent complete tenant-scoped create/read/delete smoke cycle.
- Governed, secret-free configuration backup and restore with validation preview, content checksum, explicit confirmation, safe external-delivery defaults, and attributable restore evidence.
- Operational shadow mode that runs proposal-only AI, suppresses actions and accepted assistant memory, then captures a DLP-protected human outcome comparison before autonomy increases.
- Accountable approval SLAs with automatic same-tenant ownership, scheduled substitute approvers, visible delegation evidence, aging and overdue state, and idempotent hourly escalation evidence.
- Governed edit-and-approve with DLP, immutable release/tool contract validation, revised provider idempotency, optimistic concurrency, and payload-free checksum evidence.
- An accountable recovery queue that automatically captures every failed, blocked, or deferred execution, assigns the configured recovery owner, tracks four-hour or one-day SLAs, and requires a completed same-process verification run before resolution.
- Cloudflare Agents SDK durable actors with local SQLite conversation history and immutable prompt-release bundles.
- Bounded actor-local conversational context with operator inspection, correction, quarantine, restoration, and content deletion; governance actions are revision-checked, audited, and never copied into D1 or KV.
- Explicit routing for `conversation`, `consumer`, `entity`, `shared_shard`, `temporary_durable`, `instant`, and `workflow` execution profiles.
- Workers AI model profiles whose exact allowlisted model ID is snapshotted into every immutable process release, with Agent `sessionAffinity` for prefix-cache locality on repeated durable conversations.
- D1 control-plane schema for tenants, memberships, blueprints, opportunity baselines, prompt releases, executions, approvals, webhooks, API logs, and audit events.
- Cloudflare Queues with retries and a DLQ, Workflows with retryable durable steps, and bounded Cron dispatch for tenant-configured recurring processes.
- Tenant-scoped Queue operations evidence with attempt counts, retry/dead-letter states, bounded retention, and audited safe replay from redacted execution input.
- Signed, idempotent webhook ingestion with a bounded request body and queue handoff.
- HMAC-signed outbound webhook and delegated Microsoft 365 email notifications with destination validation, Queue retries, delivery testing, and persisted attempt evidence.
- Tenant-scoped credential references whose values remain in Cloudflare secrets rather than D1, exports, logs, or browser bundles.
- An idempotent customer launch package that establishes branding, membership, a paused first process, discovery baseline, evaluation gate, and immutable draft release without duplicating records on retry.
- A role-specific Help Center with versioned training acknowledgements, team readiness, governed support requests, plain-language Cloudflare execution concepts, and live tenant process runbooks for no-dev customer operations.
- A release quality lab with curated golden cases, expected/prohibited output assertions, exact-release Workers AI runs, weighted scoring, release comparison, and token/cost evidence.
- Governed release rollback that restores only an immutable, previously evaluated release with exact-version confirmation, an operational reason, and durable from/to activation evidence.
- Durable Cloudflare Workflow evaluation suites with human scorecards and explicit promotion of stored, truncated production previews into regression cases.
- Parallel, independently retriable Workflow evaluation steps for up to 100 curated cases, with customer-weighted groundedness, completeness, safety, clarity, and format evidence.
- Portable `workrr-evaluation/v1` packages for audited, tenant-scoped rubric and anonymized dataset export/import, with idempotent merge and DLP enforcement before persistence.
- Optional Cloudflare Workers AI rubric judging with one compact secondary call per eligible case, a 25-case ceiling, DLP on judge traffic, scored evidence without hidden reasoning, and full token/cost accounting.
- Tenant-scoped organization rubric templates with seeded operational, safety, and handoff standards; applying a template copies its bounded criteria into the case so durable runs avoid repeated configuration reads.
- Portable rubric standards with backward-compatible `workrr-rubrics/v1` exchange plus Ed25519-signed `v2` publishing, tamper verification, owner/admin import approval, strict bounds and sensitive-content rejection, and destination-side activation review.
- Isolated baseline-versus-candidate Cloudflare model trials with quality/cost recommendations and automatic masking of common sensitive patterns before case persistence.
- Tenant-wide and per-process incident containment with drain/emergency-stop admission gates, deferred paused work, evidence timelines, guarded recovery, and critical notifications.
- Cloudflare Access JWT verification, server-derived tenant membership, role-based authorization, and same-origin browser mutations.
- Microsoft 365 delegated OAuth with PKCE, one-time state, selectable least-privilege Graph scopes, AES-256-GCM refresh-token storage, rotation-aware health checks, Mail.Send notification delivery, and disconnect evidence.
- Tenant-configurable DLP detectors with audit, redact, and block actions enforced before Queue, Workflow, Durable Agent, model, evaluation, and persisted-preview boundaries.
- Shared typed contracts and tests for sticky identity routing.

## Architecture boundary

D1 is the source of truth for published process and prompt releases. A durable Agent records the process-release ID separately from the prompt-release ID installed in actor SQLite; this prevents a prompt identifier from ever being mistaken for the governed process bundle. D1 is read only when a release must be copied into or attributed to that actor. Later turns use the local copy and retain the actor's installed process release even after a newer release is published. Existing actors from the earlier single-ID state are validated against the tenant/process prompt-to-release relationship and upgraded in place before execution. New actors receive the current release; migration of an existing conversation must be explicit. The stable Agent identity is also passed to Workers AI as `sessionAffinity`, allowing Cloudflare's model infrastructure to improve prefix-cache locality without KV.

Authorized operators can inspect the installed and current release from an execution's Actor Memory panel and migrate only that conversation. Migration requires exact source and target release confirmation plus a reason, preserves actor-local memory, moves the prompt/model/contracts/tool-policy bundle together, and writes attributable D1 and audit evidence.

Process Studio also provides a release-adoption inventory for durable actor fleets. It groups every known thread, consumer, entity, shard, or temporary actor into current, pinned-previous, or unattributed cohorts and exposes the 50 most recent identities for investigation. The inventory is derived from indexed execution and explicit migration evidence; it does not enumerate Durable Objects or add a D1 read to ordinary conversation turns.

Owners can move a staged percentage of the remaining pinned cohort through a dedicated Cloudflare Workflow. Admission requires the exact current release, passing evaluation evidence, a reason, no competing rollout, and a maximum of 200 selected actors. The Workflow snapshots its item list, calls each serialized Agent actor independently, preserves per-item failures, records aggregate completion/skip/failure evidence, and raises an operational notification when attention is required.

Instant executions deliberately have no durable identity and load their release from D1. Workflow executions use Cloudflare Workflows for retryable, long-lived orchestration and reload the exact release captured in the execution record at admission. Queues absorb independent bursts; they are not used as a substitute for ordered actor state.

Friendly model profiles are authoring defaults, not mutable runtime aliases. Process Studio exposes the curated Cloudflare-hosted model catalog, explains the intended workload, keeps the profile and exact model compatible, and records the exact Workers AI model ID in the release. Instant Workers, durable Agents, Workflows, evaluation runs, governance exports, privacy reports, and process packages all consume or expose that pinned value. Changing a profile mapping affects only later drafts; unknown or mismatched models fail closed.

Recurring processes are configured in Process Studio with hourly, daily, or weekly UTC schedules. Cron atomically claims at most 50 due occurrences and returns after handing them to Queue; it never performs AI inference inline. Queue routes each occurrence to the process's declared instant, sticky Agent, temporary actor, or Workflow profile. D1 retains schedule controls and dispatch evidence, while sticky state remains in the target Durable Agent.

DLP rules are tenant-scoped in D1 and loaded at each execution boundary so policy changes affect already-queued Workflow work. Email and phone values redact by default; SSNs, valid payment-card numbers, and API-secret patterns block; IP addresses default to evidence-only inspection. Audit-only content may reach the selected private model, but Workrr still masks it in D1 previews and Durable Object conversation history. DLP evidence stores detector, action, stage, direction, and count—never the matched value.

Conversation, consumer, entity, shared-shard, and temporary-durable profiles reuse only active actor-local turns. Each call is bounded to the 20 most recent turns, 24,000 total characters, and 8,000 characters per turn before the current request is added. Quarantined and deleted turns are excluded immediately. Workrr does not automatically extract or promote durable “facts”; that remains disabled until an allowlisted, provenance-bearing memory schema is implemented.

## Local development

Requirements: Node.js 22+, a Cloudflare account, and Wrangler authentication for live Workers AI calls.

```bash
npm ci
npm run cf:types
npm run db:migrate:local -w @workrr/platform-worker
npm run dev:worker
```

In a second terminal:

```bash
npm run dev
```

The admin runs at `http://localhost:5173` and proxies `/api` to the Worker on port 8787. Development mode supplies the seeded `demo` tenant and local admin identity. Production does not accept that fallback.

Before opening a pull request, run the same bounded verification used by CI:

```bash
npm run verify
```

The single Ubuntu CI job validates sequential D1 migrations, scans tracked text files for high-confidence committed secrets, rejects high or critical production dependency advisories, typechecks, tests, and performs a Wrangler dry-run build. It has a 12-minute hard timeout and cancels superseded runs on the same branch. CodeQL and operating-system matrices are intentionally excluded; this keeps ordinary `dev`/`main` validation to one hosted job while retaining the application-level security suite.

The current npm registry reports a moderate Windows path-traversal advisory in the Hono Node adapter transitively installed by the Cloudflare Agents SDK’s MCP/codemode support. Workrr deploys the Workers entrypoint, does not start that Node static-file server, and CI runs on Linux; the current MCP SDK still requires the affected 1.x range, so a forced 2.x override would violate its dependency contract. The registry also reports high libvips findings in Sharp beneath development-only Miniflare/Wrangler. Workrr does not process untrusted images during build or local emulation. CI therefore gates the deployed dependency graph at high severity while these upstream pins are monitored; it does not misrepresent the full development lockfile as advisory-free.

## Provision and deploy

Generate a customer-owned configuration outside the live file first:

```bash
npm run customer:config -- \
  --slug acme \
  --account-id 0123456789abcdef0123456789abcdef \
  --production-domain one.acme.example \
  --development-domain one-dev.acme.example \
  --access-team-domain https://acme.cloudflareaccess.com \
  --production-audience <64-character-production-audience> \
  --development-audience <64-character-development-audience> \
  --output /tmp/acme-wrangler.jsonc
```

The generator validates account, hostname, Access origin, slug, and audience formats; requires separate production/development domains and audiences; emits no credentials; omits account-assigned D1 IDs for provisioning; writes with owner-only permissions; and refuses to overwrite a file. Review it before replacing `apps/platform-worker/wrangler.jsonc` in the customer fork. Worker typechecking regenerates ignored Wrangler binding types from that customer file before compiling, so customer domains and audiences never depend on Workrr’s development literals.

Review the idempotent resource plan for the selected customer environment:

```bash
npm run provision:plan -- --env dev
```

The command derives D1, R2, Vectorize, primary Queue, and DLQ names from `wrangler.jsonc`, selects the configured Cloudflare account explicitly, and performs read-only inventory checks. Existing names are exact-matched so a DLQ cannot be mistaken for its primary Queue. To create only the missing resources:

```bash
npm run provision:plan -- --env dev --apply --confirm "PROVISION DEV"
```

Production requires the separate exact confirmation `PROVISION PRODUCTION`. Resource creation does not deploy code, apply D1 migrations, configure secrets, or alter Cloudflare Access. Wrangler can automatically provision draft D1 and R2 bindings during deployment, but the explicit plan remains the framework path because Queues and Vectorize still require named customer resources and GitHub deployments cannot write newly assigned resource IDs back to the repository.

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

### Machine access and live smoke tests

Workrr maps Cloudflare Access service tokens by the verified JWT `common_name` claim. Register the service-token Client ID (`…access`) under **Team & roles → Service principals** with an `operator` or `viewer` role. Workrr stores the Client ID as a tenant-scoped identity, but never accepts or stores the Client Secret.

The Access application also needs a Service Auth policy that includes that service token. Keep both credentials in the calling CI/FDE secret manager, then run:

```sh
WORKRR_BASE_URL=https://one-dev.workrr.ai \
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
npm run smoke:live
```

The smoke principal must be an `operator`. The command verifies session identity, governance and rubric reads, then creates, reads, and deletes a tenant-scoped disposable fixture. Cleanup is attempted even after failure, and a scheduled sweep removes abandoned fixtures after their ten-minute expiry. The command prints no credential values.

### Signed rubric standards

When `RUBRIC_SIGNING_JWK` is configured, rubric exports use `workrr-rubrics/v2` with Ed25519 publisher metadata and a detached signature over the canonical package. The private JWK remains a Wrangler secret. Imports verify the public-key fingerprint and signature before retaining a package for review; they do not create templates until an owner or admin approves the package. Approved templates remain archived until explicitly restored.

For scheduled publisher-key rollover, also configure `RUBRIC_SIGNING_VALID_FROM`, `RUBRIC_SIGNING_EXPIRES_AT`, and the prior private key as the optional Wrangler secret `RUBRIC_PREVIOUS_SIGNING_JWK`. Exports then use `workrr-rubrics/v3`: the new key signs the package and the previous key signs a narrowly scoped successor proof containing both fingerprints, the new public key, publisher name, and validity window. A destination must already trust the exact predecessor and an owner or administrator must approve the successor plus a 0–30 day overlap. Cron suspends keys at expiry. Remove the previous private-key secret after the distribution/overlap procedure is complete; it is not stored in D1 or included in packages.

A valid signature establishes package integrity, not publisher trust. Each destination tenant may recognize an exact publisher key and choose one policy:

- **Manual approval** identifies the publisher but keeps every package in the owner/admin review queue.
- **Auto-approve** accepts only packages matching both the stored key fingerprint and public key; templates still arrive archived.
- **Block** retains rejection evidence and creates no templates.

Trust policies are tenant-scoped, auditable, suspendable, and can be created only by an owner or administrator from a previously verified package.

Generate a different signing key for each publishing environment and pipe the private JWK directly into Wrangler without committing it:

```sh
node -e "crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(k=>process.stdout.write(JSON.stringify(k)))" \
  | npx wrangler secret put RUBRIC_SIGNING_JWK --env dev

# Only during a scheduled rubric publisher-key rollover:
cat previous-ed25519-private.jwk \
  | npx wrangler secret put RUBRIC_PREVIOUS_SIGNING_JWK --env dev
```

Unsigned `workrr-rubrics/v1` packages remain supported for deliberate local/manual exchange and retain the existing archived-on-import behavior.

### Cloudflare Access member handoff

Customer Setup exports the active tenant member list as an environment-bound Access handoff with no API credentials. Apply it from a trusted FDE workstation using a narrowly scoped Cloudflare token:

```bash
export CLOUDFLARE_ACCOUNT_ID="<customer-account-id>"
export CLOUDFLARE_API_TOKEN="<access-policy-token>"
npm run access:sync -- --manifest ./workrr-access-handoff-development.json
npm run access:sync -- --manifest ./workrr-access-handoff-development.json --apply
```

The first command is a dry run. The apply command resolves the Access application by both custom domain and audience, then creates or updates only the named Workrr-managed allow policy. It does not delete or replace other customer Access policies.

### Microsoft 365 OAuth registration

Create one Microsoft Entra web application for the customer deployment and register both exact callback URLs:

```text
https://one-dev.workrr.ai/oauth/microsoft/callback
https://one.workrr.ai/oauth/microsoft/callback
```

The lifecycle uses delegated permissions only. Workrr always requests `openid`, `profile`, `email`, `offline_access`, and `User.Read`; the administrator can separately select `Mail.ReadBasic`, `Calendars.ReadBasic`, and `Files.Read`. It does not request mail send, calendar write, directory-wide, or application permissions.

Store the Entra application values and an independent 32-byte encryption key as Worker secrets in each environment:

```bash
npx wrangler secret put MICROSOFT_CLIENT_ID --env dev
npx wrangler secret put MICROSOFT_CLIENT_SECRET --env dev
openssl rand -base64 32 | npx wrangler secret put OAUTH_TOKEN_ENCRYPTION_KEY --env dev

npx wrangler secret put MICROSOFT_CLIENT_ID --env=""
npx wrangler secret put MICROSOFT_CLIENT_SECRET --env=""
openssl rand -base64 32 | npx wrangler secret put OAUTH_TOKEN_ENCRYPTION_KEY --env=""
```

Use a distinct encryption key per environment and retain it in the customer’s password manager. Rotating that key requires reconnecting existing OAuth accounts because Workrr deliberately has no plaintext-token recovery path.

### Reviewable production promotion

Production promotion is dry-run by default. The command fetches the latest Git refs, requires a clean fast-forward history, verifies that `main` can be updated without rewriting it, inventories pending production D1 migrations, and lists required secret names without reading secret values:

```bash
export CLOUDFLARE_ACCOUNT_ID="<customer-account-id>"
npm run promote:production
```

When the plan reports `ready: true`, apply the exact reviewed `origin/dev` SHA from a trusted FDE workstation:

```bash
export CLOUDFLARE_API_TOKEN="<workers-build-read-token>"
npm run promote:production -- --apply --sha "<full-40-character-origin-dev-sha>" --confirm production
```

Apply mode cannot skip typecheck, tests, or the production build. It applies additive D1 migrations first, fast-forwards `main`, waits for Cloudflare Workers Builds to deploy that exact commit, then verifies the resulting Worker version and that `one.workrr.ai` redirects through `workrr-one.cloudflareaccess.com`. Promotion stops if the Microsoft OAuth secrets are absent; only secret names are inspected or printed.

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
