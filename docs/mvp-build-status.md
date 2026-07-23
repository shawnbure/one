# Workrr One MVP build status

This is the operational handoff for engineers and build agents. It describes what exists in code, the boundaries that must remain intact, and the sequence for safely promoting a customer environment.

## Product outcome

Workrr One is a customer-owned, Cloudflare-native private AI operations platform for organizations that do not maintain an AI development staff. A forward-deployed engineer discovers a manual process, configures and versions its AI behavior, chooses its execution durability, establishes human controls, and leaves the customer with an observable operating application rather than a one-off automation.

The product is deliberately process-first. Agents are an execution primitive, not the organizing metaphor in the customer UI.

## Implemented product surfaces

| Surface | Current capability |
| --- | --- |
| Overview | Live process, review, execution, health, and value indicators |
| Discover | Intake wizard, process templates, baseline capture, and opportunity scoring |
| Process Studio | Visual topology, explicit execution profile, immutable draft releases, publish, and rollback |
| Work Inbox | Evidence and rationale review, assignment, approval/decline, and audit trail |
| Activity | Run list, correlated timeline, inputs/outputs, failures, and safe replay |
| Governance | Model/data-flow inventory, retention posture, readiness, process and tenant operating modes, incident containment/recovery, and JSON evidence export |
| Team & Roles | Tenant membership administration and server-enforced role assignments |
| API Logs | Correlated request history and webhook visibility |
| Foundations | Connections, knowledge, evaluations, and model profile starting points |
| Customer setup | Idempotent launch manifest for profile, membership, paused first process, baseline, evaluation gate, draft release, readiness, and secret-free export |
| Notifications | Tenant-scoped in-app routing plus HMAC-signed webhook delivery through Queue retries, test sends, and persisted attempt evidence |
| Process portability | Versioned, validated JSON package export/import with secrets excluded and imports paused by default |
| Usage & budgets | Monthly token/cost ledger, model price snapshot, process attribution, warning policy, and optional hard limit |
| Incident response | Tenant and process emergency stops, drain/defer admission behavior, incident ownership/lifecycle, evidence timeline, recovery gates, audit, and critical notifications |
| Evaluation lab | Curated golden cases, expected/prohibited output assertions, exact-release model runs, weighted scoring, release comparison, durable Workflow suites, side-by-side Cloudflare model trials, automatic sensitive-pattern masking, human scorecards, explicit production-sample promotion, evidence, and budgeted usage |

## Execution architecture

Every process declares one execution profile:

- `instant`: ephemeral request processing with no durable identity.
- `conversation`: one durable actor per threaded conversation.
- `consumer`: one durable actor per end consumer.
- `entity`: one durable actor per business entity such as a case or account.
- `shared_shard`: a bounded set of durable actors for workloads that require durability without per-consumer cardinality.
- `temporary_durable`: an actor with temporary durable state and an explicit lifecycle.
- `workflow`: Cloudflare Workflow orchestration for long-running, retryable multi-step work.

Durable actors use the Cloudflare Agents SDK and Durable Object SQLite. Many instances of the same agent class are expected; the stable identity key determines stickiness. Worker isolates remain ephemeral and must never be treated as a memory store.

Queues absorb independent bursts and provide retry/DLQ behavior. Workflows provide durable orchestration. Cron performs scheduled maintenance. These primitives are complementary and must not be collapsed into one generic runner.

## Prompt and memory read model

D1 is the control-plane source of truth. Published prompt/process releases are immutable. A durable agent reads D1 only when it does not have the requested release in its local SQLite database, then installs that release locally. Repeated turns use the actor-local release and conversation state, avoiding a D1 read for every message.

The stable agent identifier is passed to Workers AI as `sessionAffinity`, improving prefix-cache locality where supported. This is an optimization, not correctness state. Instant execution reads the required release from D1 because it intentionally has no durable actor-local cache.

Do not add KV for prompts unless measurement proves a distinct global distribution need. It would add another consistency boundary without replacing durable conversation memory.

## Security and tenancy invariants

- Cloudflare Access is the browser identity perimeter.
- The Worker verifies the Access JWT signature and application audience.
- Email-to-tenant membership and role resolution happens server-side from D1.
- Callers may not supply a trusted tenant or role header.
- Mutating browser requests require same-origin context.
- Webhooks require HMAC SHA-256 signatures, enforce a 1 MB body maximum, deduplicate deliveries, and hand accepted work to a Queue.
- Webhook secrets are Wrangler secrets. They are never stored in Git or returned by an API.
- Outbound connector credentials remain Cloudflare secrets. D1 stores only tenant-scoped binding references, readiness metadata, and redacted delivery evidence.
- Outbound webhook delivery accepts only public HTTPS destinations on port 443 without query credentials, refuses redirects, signs `timestamp.body` with HMAC-SHA256, and uses the notification event ID as its idempotency key.
- Governance exports are redacted evidence, not a raw secret/configuration dump.
- Production must have its own Access application and audience; never reuse development's audience.
- The account Zero Trust organization is `Workrr One` at `workrr-one.cloudflareaccess.com`; legacy organization names must not appear in customer authentication.

## Control-plane API map

The Worker currently exposes these route groups:

- Session and tenant administration: `/api/session`, `/api/members`, `/api/onboarding`, `/api/onboarding/bootstrap`
- Discovery and value: `/api/process-templates`, `/api/processes`, `/api/value`
- Studio and controls: `/api/processes/:id/studio`, release publish, release-specific evaluation gate, operating mode
- Portability: `/api/processes/:id/package`, `/api/process-packages/import`
- Execution: `/api/execute`, `/api/execute/async`, `/api/executions`, retry
- Human review: `/api/approvals`, assignment, approve/decline
- Evidence: `/api/audit`, `/api/logs`, `/api/governance`, `/api/governance/export`
- Integration intake: `/webhooks/:endpointId`, `/api/webhooks`
- Operational delivery: `/api/notifications`, policy configuration, and signed delivery tests
- Incident operations: `/api/incidents`, lifecycle transitions, `/api/tenant/mode`, and process containment/recovery
- Quality controls: `/api/evaluations/:id`, curated cases, exact-release runs, and publish gates
- Operations: `/health`, `/api/overview`, `/api/system/capabilities`

Role checks are attached at the route boundary and repository queries remain tenant-scoped.

## Database migration order

Migrations are additive and ordered in `apps/platform-worker/migrations`:

1. `0001_initial.sql`: core tenant/process/release/execution schema.
2. `0002_identity_and_operations.sql`: identity and operational records.
3. `0003_process_studio.sql`: studio and release lifecycle.
4. `0004_governance_foundations.sql`: operating controls and governance data.
5. `0005_webhooks_and_api_logs.sql`: webhook and API observability records.
6. `0006_process_discovery.sql`: discovery intake and value baselines.
7. `0007_evaluation_runs.sql`: persisted deterministic release-gate evidence.
8. `0008_execution_usage.sql`: per-execution token accounting and model usage reporting.
9. `0009_customer_onboarding.sql`: customer branding, operating defaults, and bootstrap state.
10. `0010_notification_policies.sql`: alert routing policies and delivery evidence.
11. `0011_release_evaluation_gate.sql`: release-specific evaluation status and scenario backfill.
12. `0012_usage_budgets.sql`: captured model rates, execution cost estimates, and tenant budget policy.
13. `0013_connector_delivery.sql`: secret references, signed webhook policy, and delivery attempt evidence.
14. `0014_customer_bootstrap.sql`: idempotent customer launch evidence and provisioned baseline references.
15. `0015_evaluation_lab.sql`: curated golden cases, case-level results, release scores, inference usage, and comparison evidence.
16. `0016_evaluation_operations.sql`: durable suite lifecycle, Workflow correlation, and tenant-scoped human review scorecards.
17. `0017_evaluation_score_backfill.sql`: truthful percentage scores for evaluation evidence created before case-level scoring.
18. `0018_model_trials_and_redaction.sql`: isolated model-profile trials, profile-attributed evidence, and persisted redaction metadata.
19. `0019_incident_response.sql`: tenant admission controls, expanded incident records, evidence timelines, and emergency notification policy.

Development migrations are applied before each matching development deploy. Production migration remains an explicit reviewed release action.

## Environments and deployment

| Environment | Worker | Domain | Branch | State |
| --- | --- | --- | --- | --- |
| Development | `workrr-platform-dev` | `one-dev.workrr.ai` | `dev` | Auto-deploying and Access-protected |
| Production | `workrr-platform` | `one.workrr.ai` | `main` | Access-protected; promoted from reviewed dev releases |

Cloudflare Workers Builds owns deployment. GitHub Actions must not duplicate it. Non-production branch builds are disabled to control build usage.

Before each production promotion:

1. Verify the production Access application and explicit customer allow policy.
2. Verify the production `ACCESS_TEAM_DOMAIN` and production-specific `ACCESS_AUD`; never reuse dev's audience.
3. Validate tenant memberships and least-privilege roles.
4. Configure `WEBHOOK_INBOX_SECRET` and `NOTIFICATION_WEBHOOK_SECRET` with `wrangler secret put`; never place values in D1 or Git.
5. Review and apply pending D1 migrations to the production database.
6. Run typecheck, tests, build, and a dry-run deploy.
7. Merge the reviewed `dev` commit into `main`, then verify health, Access redirect, login, one read, and one controlled mutation.

## Verification contract

Run for every release:

```bash
npm run typecheck
npm test
npm run build
```

For changes to identity, tenant scoping, release publication, approval decisions, replay, or webhook handling, add endpoint-level tests before promotion. A successful frontend build alone is not adequate evidence.

The runtime suite proves that authenticated membership overrides forged tenant/role headers, cross-origin mutations are rejected before business writes, viewers cannot change administrative policy, containment, or customer baselines, onboarding retries do not duplicate processes, first processes start paused with draft releases, paused inputs are recorded as deferred, tenant drain/emergency stop blocks synchronous and queued admission, incident recovery requires containment evidence, inbound webhooks reject invalid/unapproved input and deduplicate delivery, outbound webhooks restrict destinations, sign envelopes, avoid duplicate delivery, and require configured credentials, Workflows persist token usage and terminal failures, durable identity keys remain sticky only within the intended scope, and release-specific golden cases enforce expected/prohibited output assertions while capturing usage. These tests run locally with mocked model calls and no external deliveries.

Interactive evaluation runs are deliberately limited to ten enabled curated cases per scenario. Durable suite runs use a dedicated Cloudflare Workflow, survive browser disconnection, retry the exact-release regression idempotently, and persist their lifecycle separately from case evidence. Model trials execute the immutable release prompt and identical cases once with the release baseline profile and once with a candidate Cloudflare profile; both arms are costed and scored without changing the live process or release-gate state. Every model call participates in the tenant hard budget.

Production inputs are never sampled automatically. An authorized user may explicitly promote only the already-stored, truncated execution preview into a case. Before persistence, Workrr masks common email, phone, SSN, payment-card, and secret-token patterns and records redaction counts/types. This is a safety net, not a substitute for customer data-classification policy or a full DLP engine. Much larger batch datasets should add Workflow fan-out rather than extending one inference step indefinitely.

## Remaining aggressive-MVP work

The foundation is usable, but these are the highest-value next slices:

1. Register and credential the first customer Microsoft Entra application. The provider-specific lifecycle is implemented with delegated PKCE authorization, capability-scoped consent, encrypted refresh-token persistence, rotation-aware health checks, and disconnect/reconnect controls.
2. Add richer multi-dimension rubrics, customer-configurable DLP policies, and Workflow fan-out for large datasets. Automatic common-pattern masking, isolated model-to-model shadow comparison, durable suites, bounded human scorecards, explicit truncated production-sample promotion, curated assertions, scoring, exact-release publish gates, and release comparison are implemented.
3. Reconcile Workrr estimates with Cloudflare billing exports when a supported account billing API/export is selected. The in-product priced ledger is implemented.
4. Add authenticated email delivery using the Microsoft lifecycle; Queue-backed signed webhook delivery is implemented.
5. Add a scripted, reviewable environment promotion command. Cloudflare Access member handoff is implemented as a secret-free, environment-bound export plus an explicit dry-run/apply FDE command.
6. Expand the current identity, tenant, role, OAuth replay/encryption, package, durable-stickiness, Workflow accounting, webhook-deduplication, and Access-handoff tests into live-environment smoke tests with disposable customer fixtures.

Each slice should preserve the core boundary: D1 controls configuration and reporting, durable actors own sticky conversational state, Workflows own long-running orchestration, and Queues own burst absorption.
