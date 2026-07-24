# Workrr One

Workrr is a Cloudflare-native private AI operations framework for mid-market organizations without an internal AI engineering team. It packages repeatable AI processes, durable conversations, human approvals, and operational visibility into a customer-owned deployment.

## What is implemented

- A polished React operations console with process discovery, Process Studio, Work Inbox, execution activity, governance, team roles, API logs, model profiles, and value reporting.
- Six implementation-ready customer starters spanning triage, document intake, knowledge assistance, lead qualification, approved external action, and scheduled reconciliation. Creation rejects incomplete starter shells and presents the full catalog in a readable, responsive wizard.
- Two versioned, repository-validated open-source solution packs for customer operations and scheduled reconciliation, each with a directly importable paused process, typed connection seams, topology, handoff checklist, and portable release-gate cases. Process Studio also provides a metadata-only library for exact-version, server-owned installation without transferring credentials, schedules, or publication authority.
- Installed solution packs retain tenant-scoped pack/version provenance. Process Studio identifies the source and reports a newer reviewed catalog version without mutating customer changes or automatically upgrading a process.
- Pack requirements become attributable Process Studio checks with optimistic revisions and substantive completion evidence. Each manifest check explicitly declares whether it blocks publication or remains an accountable post-install handoff obligation; the server never derives authority from checklist prose.
- Governed Cloudflare Email Routing intake with SMTP-envelope sender allowlists, DLP, RFC-thread or consumer stickiness, Queue buffering, metadata-only receipts, and no raw MIME or attachment retention. See [`docs/inbound-email-channel.md`](docs/inbound-email-channel.md).
- A keyboard-accessible command center that searches authorized workspaces and processes, opens exact employee or operator destinations, and excludes administrative surfaces and non-runnable processes from consumer results.
- An accessible account menu that makes the server-resolved organization, role, environment, and Cloudflare Access identity visible, with a same-origin secure sign-out path.
- Managed deployment visibility using Cloudflare Worker Version Metadata plus an exact D1 migration compatibility check, surfaced in Customer Setup without touching agent request paths.
- Latched automatic autonomy fallback: unsafe human reviews immediately cap a process at Suggest, hourly bounded reliability checks cap it at Approve, and an owner must record recovery evidence before the published autonomy becomes eligible again.
- An executive value portfolio that combines 30-day business-value snapshots, run outcomes, incidents, safety caps, and discovery baselines into transparent expand/correct/observe/hold/retire recommendations without another model call or automatic autonomy promotion.
- Gross value, captured Workers AI operating-cost estimates, net value, and value-to-cost efficiency shown together; expansion requires positive net value and the UI distinguishes estimates from reconciled Cloudflare billing.
- Organization and per-process monthly AI budgets with visible warning allocation, optional hard limits enforced before every model-call path, and deduplicated owned threshold alerts emitted by hourly maintenance.
- Governed customer outcome capture with server-side baseline calculations, tenant DLP, attributable evidence references, and void-instead-of-rewrite corrections so the value portfolio works beyond seeded demonstration data.
- Owner-approved 30-day process targets with volume, effort, value, exception thresholds, review dates, DLP-protected evidence, optimistic revisions, and progress reporting that never promotes autonomy automatically.
- Hourly bounded target-review reminders with seven-day and overdue stages, D1-enforced per-revision deduplication, accountable in-app response tasks, and opt-in email/webhook delivery.
- Product-wide readability floors for metadata, body copy, controls, statuses, and mobile touch targets.
- Failure-isolated hourly maintenance with bounded per-control receipts and owned degradation alerts visible in Customer Setup.
- Server-enforced launch readiness that blocks a new release publication until the process has both a discovery baseline and a current owner-approved value target, with the exact evidence shown in Process Studio.
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
- Workers AI model profiles whose exact allowlisted model ID is snapshotted into every immutable process release, with Agent `sessionAffinity` for prefix-cache locality on repeated durable conversations, plus an owner-governed Cloudflare AI Gateway handoff for explicitly approved third-party models.
- Process Studio prompt budgeting that separates stored release content from bounded runtime context, shows section estimates/model headroom and observed model-call timing, and blocks oversized drafts without KV or another execution hot-path read.
- Governed knowledge ingestion through R2 and tenant-namespaced Vectorize, including Cloudflare Workers AI conversion for PDF, Word, PowerPoint, Excel, HTML, and OpenDocument files. Only DLP-protected extracted text is retained; raw binary uploads are not stored.
- D1 control-plane schema for tenants, memberships, blueprints, opportunity baselines, prompt releases, executions, approvals, webhooks, API logs, and audit events.
- Cloudflare Queues with retries and a DLQ, Workflows with retryable durable steps, and bounded Cron dispatch for tenant-configured recurring processes.
- Tenant-scoped Queue operations evidence with attempt counts, retry/dead-letter states, bounded retention, recovery owner/SLA visibility, and audited safe replay from redacted execution input. A failed initial Queue handoff atomically fails the execution so it cannot remain invisibly queued and immediately enters accountable recovery.
- Signed, idempotent webhook ingestion with a bounded request body and queue handoff.
- HMAC-signed outbound webhook and delegated Microsoft 365 email notifications with destination validation, Queue retries, delivery testing, and persisted attempt evidence.
- Tenant-scoped credential references whose values remain in Cloudflare secrets rather than D1, exports, logs, or browser bundles.
- An idempotent customer launch package that establishes branding, membership, a paused first process, discovery baseline, evaluation gate, and immutable draft release without duplicating records on retry.
- A role-specific Help Center with versioned training acknowledgements, team readiness, governed support requests, plain-language Cloudflare execution concepts, and live tenant process runbooks for no-dev customer operations.
- A release quality lab with curated golden cases, expected/prohibited output assertions, exact-release Workers AI runs, weighted scoring, release comparison, and token/cost evidence.
- Governed release rollback that restores only an immutable, previously evaluated release with exact-version confirmation, an operational reason, and durable from/to activation evidence.
- On-demand, server-derived release review that compares a candidate or rollback target with the active immutable bundle across prompts, instructions, guardrails, exact model, autonomy, classification, contracts, typed tool policies, and workflow steps before an owner acts.
- Terminal owner approval or rejection bound to the reviewed release checksum. Publication fails closed without approval, and a high-risk release requires a different owner or administrator from its author; emergency rollback retains its separately evaluated recovery path.
- Durable Cloudflare Workflow evaluation suites with human scorecards and explicit promotion of stored, truncated production previews into regression cases.
- Parallel, independently retriable Workflow evaluation steps for up to 100 curated cases, with customer-weighted groundedness, completeness, safety, clarity, and format evidence.
- Portable `workrr-evaluation/v1` packages for audited, tenant-scoped rubric and anonymized dataset export/import, with idempotent merge and DLP enforcement before persistence.
- Optional Cloudflare Workers AI rubric judging with one compact secondary call per eligible case, a 25-case ceiling, DLP on judge traffic, scored evidence without hidden reasoning, and full token/cost accounting.
- Tenant-scoped organization rubric templates with seeded operational, safety, and handoff standards; applying a template copies its bounded criteria into the case so durable runs avoid repeated configuration reads.
- Portable rubric standards with backward-compatible `workrr-rubrics/v1` exchange plus Ed25519-signed `v2` publishing, tamper verification, owner/admin import approval, strict bounds and sensitive-content rejection, and destination-side activation review.
- Isolated baseline-versus-candidate Cloudflare model trials with quality/cost recommendations and automatic masking of common sensitive patterns before case persistence.
- Tenant-wide and per-process incident containment with drain/emergency-stop admission gates, deferred paused work, evidence timelines, guarded recovery, and critical notifications.
- Accountable quarterly governance reviews for privacy architecture, model inventory, access roles, and incident recovery, with due-state readiness, bounded evidence references, owner-only completion, immutable audit events, and deduplicated Cron-driven due/overdue tasks.
- Cloudflare Access JWT verification, server-derived tenant membership, role-based authorization, and same-origin browser mutations.
- Microsoft 365 delegated OAuth with PKCE, one-time state, selectable least-privilege Graph scopes, AES-256-GCM refresh-token storage, rotation-aware health checks, Mail.Send notification delivery, and disconnect evidence.
- Tenant-configurable DLP detectors with audit, redact, and block actions enforced before Queue, Workflow, Durable Agent, model, evaluation, and persisted-preview boundaries.
- Release-pinned public/internal/confidential/restricted classification with independent, revisioned external-model and external-tool egress gates; native Workers AI remains the private Cloudflare-default path.
- Shared typed contracts and tests for sticky identity routing.

## Architecture boundary

D1 is the source of truth for published process and prompt releases. A durable Agent records the process-release ID separately from the prompt-release ID installed in actor SQLite; this prevents a prompt identifier from ever being mistaken for the governed process bundle. D1 is read only when a release must be copied into or attributed to that actor. Later turns use the local copy and retain the actor's installed process release even after a newer release is published. Existing actors from the earlier single-ID state are validated against the tenant/process prompt-to-release relationship and upgraded in place before execution. New actors receive the current release; migration of an existing conversation must be explicit. Every new process also uses a versioned actor identity containing the authenticated tenant, process, profile, and business reference, so identical consumer/thread identifiers in two customer deployments cannot address the same Durable Object. Preexisting actors retain their legacy name to avoid orphaning memory and remain guarded by the actor's immutable tenant/process binding. An owner may upgrade a paused legacy process only when a tenant-scoped, race-rechecked D1 query proves that it has never created a durable actor; a memory-bearing fleet cannot be renamed in place. The stable Agent identity is also passed to Workers AI as `sessionAffinity`, allowing Cloudflare's model infrastructure to improve prefix-cache locality without KV.

Authorized operators can inspect the installed and current release from an execution's Actor Memory panel and migrate only that conversation. Migration requires exact source and target release confirmation plus a reason, preserves actor-local memory, moves the prompt/model/contracts/tool-policy bundle together, and writes attributable D1 and audit evidence.

Process Studio also provides a release-adoption inventory for durable actor fleets. It groups every known thread, consumer, entity, shard, or temporary actor into current, pinned-previous, or unattributed cohorts and exposes the 50 most recent identities for investigation. The inventory is derived from indexed execution and explicit migration evidence; it does not enumerate Durable Objects or add a D1 read to ordinary conversation turns.

Owners can move a staged percentage of the remaining pinned cohort through a dedicated Cloudflare Workflow. Admission requires the exact current release, passing evaluation evidence, a reason, no competing rollout, and a maximum of 200 selected actors. The Workflow snapshots its item list, calls each serialized Agent actor independently, preserves per-item failures, records aggregate completion/skip/failure evidence, and raises an operational notification when attention is required.

Instant executions deliberately have no durable identity and load their release from D1. Workflow executions use Cloudflare Workflows for retryable, long-lived orchestration and reload the exact release captured in the execution record at admission. Queues absorb independent bursts; they are not used as a substitute for ordered actor state.

Friendly model profiles are authoring defaults, not mutable runtime aliases. Process Studio exposes the curated Cloudflare-routed model catalog, explains the intended workload, keeps the profile and exact model compatible, and records the exact model ID in the release. Owners control a tenant approval list used by drafts, publication, rollback, evaluations, and model trials. A model cannot be removed while an active release or a known durable actor remains pinned to it. Native Workers AI turns require no additional model-policy read. The optional AI Gateway handoff starts disabled, requires separate owner privacy/billing evidence and model approval, uses Cloudflare-managed Unified Billing without provider secrets, bypasses dynamic-response caching, and records bounded routing evidence. Changing a profile mapping affects only later drafts; unknown, mismatched, or organization-unapproved models fail closed.

Recurring processes are configured in Process Studio with hourly, daily, or weekly UTC schedules. Cron atomically claims at most 50 due occurrences and returns after handing them to Queue; it never performs AI inference inline. Queue routes each occurrence to the process's declared instant, sticky Agent, temporary actor, or Workflow profile. D1 retains schedule controls and dispatch evidence, while sticky state remains in the target Durable Agent.

DLP rules are tenant-scoped in D1 and loaded at each execution boundary so policy changes affect already-queued Workflow work. Email and phone values redact by default; SSNs, valid payment-card numbers, and API-secret patterns block; IP addresses default to evidence-only inspection. Audit-only content may reach the selected private model, but Workrr still masks it in D1 previews and Durable Object conversation history. DLP evidence stores detector, action, stage, direction, and count—never the matched value.

Conversation, consumer, entity, shared-shard, and temporary-durable profiles reuse only active actor-local turns. Each call is bounded to the 20 most recent turns, 24,000 total characters, and 8,000 characters per turn before the current request is added. Quarantined and deleted turns are excluded immediately. Long-term facts remain actor-local and are never inferred automatically: an operator must propose bounded content from an active source turn, tenant DLP must pass, and a separate governed approval must activate it. At most 20 unexpired approved facts and 4,000 fact characters enter context.

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

The single Ubuntu CI job validates sequential D1 migrations, scans tracked text files for high-confidence committed secrets, rejects high or critical production dependency advisories, runs ESLint with typed production promise checks and React Hooks enforcement, typechecks, tests, and performs a Wrangler dry-run build. It has a 12-minute hard timeout and cancels superseded runs on the same branch. Generated Wrangler bundles and build output are excluded from lint; tests remain syntax and unused-code checked without being treated as production tsconfig inputs. CodeQL and operating-system matrices are intentionally excluded; this keeps ordinary `dev`/`main` validation to one hosted job while retaining the application-level security suite.

The current npm registry reports a moderate Windows path-traversal advisory in the Hono Node adapter transitively installed by the Cloudflare Agents SDK’s MCP/codemode support. Workrr deploys the Workers entrypoint, does not start that Node static-file server, and CI runs on Linux; the current MCP SDK still requires the affected 1.x range, so a forced Agents downgrade would violate the framework contract. Wrangler 4.114 removed the prior high-severity Sharp/libvips development-tool finding. CI gates the deployed dependency graph at high severity and the full lockfile currently has no high or critical advisory; it does not misrepresent the remaining upstream moderate finding as fixed.

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

Production requires the separate exact confirmation `PROVISION PRODUCTION`. When the exact D1 database exists or is created, the apply command resolves its account-assigned UUID from a fresh exact-name inventory and writes it only to the selected environment's `DB` binding. It refuses ambiguous names, an existing different UUID, and a stale temporary file. The Wrangler change is owner-only and should be reviewed and committed before deployment. Resource creation still does not deploy code, apply D1 migrations, configure secrets, or alter Cloudflare Access.

Review the complete deployment plan:

```bash
npm run customer:deploy -- --env dev
```

After the D1 binding diff is committed and an expiring Access operator service principal is available in the local shell, run the confirmed lifecycle:

```bash
export WORKRR_BASE_URL="https://one-dev.acme.example"
export CF_ACCESS_CLIENT_ID="..."
export CF_ACCESS_CLIENT_SECRET="..."

npm run customer:deploy -- \
  --env dev \
  --apply \
  --confirm "DEPLOY DEV" \
  --receipt "$HOME/.config/workrr/acme-dev-deployment.json"
```

The receipt path must be absolute, outside the repository, and unused. The command requires a clean `dev` branch for development or `main` for production, pins the configured Cloudflare account, provisions/binds resources, runs the full repository verification, applies additive remote D1 migrations, deploys the Worker and static admin assets, and completes the Access-protected fixture smoke. If provisioning changes Wrangler, the command stops before migrations so the D1 binding can be reviewed and committed; rerunning is safe. Stage receipts contain timestamps and durations but no commands, output, credentials, prompts, memory, or customer payloads.

Cloudflare Workers Builds remains the recommended routine Git deployment path after the first environment is prepared. `customer:deploy` is the guarded FDE bootstrap/recovery path and produces stronger customer handoff evidence; it does not replace branch-based CI for ordinary releases.

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

An FDE can create the exact token, specific-token Service Auth policy, and Workrr operator registration as one reviewed operation. The Cloudflare API token used here needs only `Access: Service Tokens Write` and `Access: Apps and Policies Write`; Wrangler must already be authenticated for the selected customer account's D1:

```sh
export CLOUDFLARE_API_TOKEN="<least-privilege-bootstrap-token>"

# Read-only plan: resolves the app by both domain and audience.
npm run access:bootstrap-service -- \
  --env dev \
  --tenant demo

# Apply only after review. The credential file must be absolute, outside this
# repository, and must not already exist.
npm run access:bootstrap-service -- \
  --env dev \
  --tenant demo \
  --duration 2160h \
  --credential-file "$HOME/.config/workrr/dev-smoke.json" \
  --apply \
  --confirm "BOOTSTRAP DEV SERVICE PRINCIPAL" \
  --smoke
```

The default duration is 90 days and `forever` is rejected. The generated credential file is created with owner-only mode `0600`; neither the Client Secret nor the Cloudflare API token is printed, sent to Workrr, or stored in D1. The policy trusts only the newly created token—not “any valid service token.” If the named token already exists, the command stops rather than silently rotating a one-time secret. Production uses `--env production` and the exact confirmation `BOOTSTRAP PRODUCTION SERVICE PRINCIPAL`.

For credentials managed separately, the underlying smoke command remains:

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
