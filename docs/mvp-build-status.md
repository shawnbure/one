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
| Governance | Model/data-flow inventory, retention posture, readiness, operating modes, and JSON evidence export |
| Team & Roles | Tenant membership administration and server-enforced role assignments |
| API Logs | Correlated request history and webhook visibility |
| Foundations | Connections, knowledge, evaluations, and model profile starting points |

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
- Governance exports are redacted evidence, not a raw secret/configuration dump.
- Production must have its own Access application and audience; never reuse development's audience.

## Control-plane API map

The Worker currently exposes these route groups:

- Session and tenant administration: `/api/session`, `/api/members`
- Discovery and value: `/api/process-templates`, `/api/processes`, `/api/value`
- Studio and controls: `/api/processes/:id/studio`, release publish, operating mode
- Execution: `/api/execute`, `/api/execute/async`, `/api/executions`, retry
- Human review: `/api/approvals`, assignment, approve/decline
- Evidence: `/api/audit`, `/api/logs`, `/api/governance`, `/api/governance/export`
- Integration intake: `/webhooks/:endpointId`, `/api/webhooks`
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

Development migrations are applied before each matching development deploy. Production migration remains an explicit reviewed release action.

## Environments and deployment

| Environment | Worker | Domain | Branch | State |
| --- | --- | --- | --- | --- |
| Development | `workrr-platform-dev` | `one-dev.workrr.ai` | `dev` | Auto-deploying and Access-protected |
| Production | `workrr-platform` | `one.workrr.ai` | `main` | Promotion-gated |

Cloudflare Workers Builds owns deployment. GitHub Actions must not duplicate it. Non-production branch builds are disabled to control build usage.

Before a production promotion:

1. Create the production Access application and explicit customer allow policy.
2. Set the production `ACCESS_TEAM_DOMAIN` and production-specific `ACCESS_AUD`.
3. Validate tenant memberships and least-privilege roles.
4. Configure integration secrets with `wrangler secret put` when a real sender exists.
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

## Remaining aggressive-MVP work

The foundation is usable, but these are the highest-value next slices:

1. Customer onboarding wizard that provisions membership, branding, default controls, and a first process from a single manifest.
2. Connector credential vault and OAuth lifecycle, beginning with one real customer system rather than a broad empty catalog.
3. Evaluation datasets, test runs, release comparison, and publish gates.
4. Usage/cost ledger by tenant, process, release, model, and execution profile.
5. Notification policies for approvals, failures, DLQ events, and control violations.
6. Import/export of a portable process package with secrets excluded.
7. Production Access bootstrap and a scripted, reviewable environment promotion command.
8. End-to-end tests covering identity, tenant isolation, durable stickiness, workflow retries, and webhook deduplication.

Each slice should preserve the core boundary: D1 controls configuration and reporting, durable actors own sticky conversational state, Workflows own long-running orchestration, and Queues own burst absorption.
