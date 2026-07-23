# Workrr One MVP build status

This is the operational handoff for engineers and build agents. It describes what exists in code, the boundaries that must remain intact, and the sequence for safely promoting a customer environment.

## Product outcome

Workrr One is a customer-owned, Cloudflare-native private AI operations platform for organizations that do not maintain an AI development staff. A forward-deployed engineer discovers a manual process, configures and versions its AI behavior, chooses its execution durability, establishes human controls, and leaves the customer with an observable operating application rather than a one-off automation.

The product is deliberately process-first. Agents are an execution primitive, not the organizing metaphor in the customer UI.

## Implemented product surfaces

| Surface | Current capability |
| --- | --- |
| Overview | Live process, review, execution, health, and value indicators |
| Opportunities | Manual-process intake, transparent impact/feasibility scoring, qualification, and secure conversion to paused draft processes |
| Discover | Intake wizard, process templates, baseline capture, and opportunity scoring |
| Process Studio | Visual topology, explicit execution profile, enforced five-level autonomy, immutable prompt/model/input-output contract releases, publish/rollback, and recurring process schedules with dispatch history |
| Work Inbox | Evidence and rationale review, validated assignment, comments, information request/response, escalation, approval/decline, and audit trail |
| Activity | Run list, correlated timeline, approved external-action queue, inputs/outputs, failures, and safe replay/recovery |
| Queue operations | Tenant-scoped process and approved-action enqueue/processing/retry/dead-letter evidence, bounded retention, and operator-authorized safe replay |
| Governance | Model/data-flow inventory, retention posture, readiness, process and tenant operating modes, incident containment/recovery, JSON evidence export, and printable privacy/architecture summary |
| Team & Roles | Tenant membership administration and server-enforced role assignments |
| API Logs | Correlated request history and webhook visibility |
| Knowledge Center | Governed text/file intake, pre-storage DLP, R2 source/chunk storage, queued Workers AI embedding, tenant-filtered Vectorize retrieval, process bindings, review/expiry enforcement, execution citation evidence, diagnostics, test query, reindex, and removal |
| Foundations | Truthful connection health, credential ownership/expiry, typed tool catalog, evaluations, and model profile starting points |
| Customer setup | Idempotent launch manifest plus managed-lifecycle ownership, maintenance timing, recovery review, evidence-based preflight, Access handoff, and redacted support export |
| Notifications | Owned in-app response tasks with acknowledgement SLAs and Cron escalation, plus quiet-hour-aware webhook delivery and true hourly/daily Microsoft 365 email digests with persisted provider evidence |
| Process portability | Versioned, validated JSON package export/import with secrets excluded and imports paused by default |
| Process retirement | Immediate execution/ingestion shutdown, legal hold, independent approval, cooling period, Cron/Queue disposal, durable-actor erasure, selected content redaction, and retained audit evidence |
| Usage & budgets | Monthly token/cost ledger, model price snapshot, process attribution, warning policy, optional hard limit, and Cloudflare billing-evidence reconciliation |
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

Queues absorb independent bursts and provide retry/DLQ behavior. Workflows provide durable orchestration. Cron performs maintenance and atomically claims a bounded set of due tenant schedules, then hands them to Queue without running AI inline. These primitives are complementary and must not be collapsed into one generic runner.

Every published release also declares an autonomy level that is enforced at runtime:

- `observe` records the accepted input without invoking Workers AI.
- `suggest` produces a recommendation but authorizes no external action.
- `approve` withholds durable assistant memory and routes the proposal to the Work Inbox.
- `guarded` completes only when the process declares no consequential tools; tool-capable proposals require review.
- `autonomous` completes without a checkpoint inside the published release and operating controls.

The process `read_only` operating mode caps any non-observe release at `suggest`. `approval_only` forces every non-observe release through review. Execution records snapshot the effective level and disposition so later release changes cannot rewrite historical evidence. Approving or rejecting a pending item also resolves the associated execution and records the decision audit.

## Typed tool boundary

Process tools are tenant-scoped governed definitions, not arbitrary model-selected code. Each definition declares JSON Schema input/output contracts, read/write access, risk, adapter kind, connection reference, data classification, owner, rate limit, support instructions, enabled state, and explicit process bindings. A draft release snapshots the enabled tool policies into its compiled checksum. Binding or disabling a catalog tool therefore affects only a future release; it cannot silently alter a published process. Portable process packages carry the non-secret typed definitions and omit source connection IDs/readiness; a destination must supply its own connection before a non-mock adapter can become ready.

Runtime blueprint loading overlays current connection health onto the immutable release policy in the same D1 read. Guarded mode permits only low-risk, read-only, connection-ready tools without review. Write, elevated-risk, or unavailable tools route to the Work Inbox. Autonomous mode also falls back to review when a required connection is unavailable. Every execution stores the evaluated tool-policy snapshot for Activity evidence.

The model-facing runtime exposes at most 20 release-snapshotted tools and stops after four model steps. A ready, low-risk, read-only `mock` tool may return an explicitly labeled simulation; it contacts no external system. Registered Microsoft profile, mail-metadata, and calendar-metadata reads execute through fixed endpoints with exact delegated scopes. Every other tool remains proposal-only unless it has a reviewed adapter. A proposal returns an approval-required result, performs no action, routes the execution to the Work Inbox, and is excluded from accepted durable assistant memory.

Every attempted call gets an idempotent `tool_invocations` record with the release tool/version, model call ID, bounded input/output evidence, execution mode, access/risk policy, timestamps, and terminal state. Workflow retries cannot create a duplicate invocation for the same execution and model call. Activity shows these records separately from the published tool policy, making the difference between “available,” “simulated,” “proposed,” and eventually “bound/completed” explicit. The MVP deliberately does not allow arbitrary customer code execution or let catalog metadata directly call a URL.

The first approved write adapter creates one event in the connected Microsoft 365 default calendar. The exact proposed subject, time bounds, time zone, location, and body are visible before approval; attendees are intentionally unsupported so an MVP approval cannot silently send invitations. Approval creates an immutable `tool_action_dispatches` record and Queue message. The Queue consumer—not the request Worker—owns provider execution, bounded retries, and terminal evidence. Microsoft Graph receives the invocation idempotency key as `transactionId`, so a Queue retry cannot intentionally create a second event. Approval, enqueue, attempts, provider resource ID, failures, and final execution settlement remain distinct in Work Inbox and Activity. A Cron recovery pass re-enqueues dispatches whose initial Queue handoff failed. Admins, owners, and operators can safely retry a terminal failure with the same provider idempotency identity or cancel a dispatch before provider processing starts; both operations are tenant-scoped, role-protected, and audited.

The first bound adapter registry supports three fixed, delegated Microsoft Graph reads: the connected account profile (`User.Read`), recent message metadata (`Mail.ReadBasic`), and upcoming calendar metadata (`Calendars.ReadBasic`). A bound adapter becomes executable only when its exact handler, Microsoft connection, delegated scope, read access, low-risk classification, published release snapshot, and guarded/autonomous policy all agree. `approve` remains proposal-only. Endpoints, HTTP method, selected fields, item limits, redirect policy, timeout, and 64 KB response ceiling are code-owned rather than model-controlled. Tool inputs and results cross tenant DLP before egress/model use; stored invocation evidence uses the always-redacted representation. OAuth access tokens are short-lived, never logged, and the existing encrypted refresh-token rotation path is reused.

Bound invocations intentionally perform small D1 control-plane reads for prior idempotency evidence, the per-tool minute limit, the tenant DLP policy, and the tenant OAuth record. Prompt and conversation hot state remain in Durable Object SQLite as described below; D1 is not used as a repeated prompt-content cache. A future credential-broker Durable Object may reduce OAuth refresh traffic, but it is not required for correctness and no token material is placed in KV or Cache API.

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
- Studio and controls: `/api/processes/:id/studio`, release publish, release-specific evaluation gate, operating mode, `/api/process-schedules`, create/pause/restore/run-now
- Portability: `/api/processes/:id/package`, `/api/process-packages/import`
- Execution: `/api/execute`, `/api/execute/async`, `/api/executions`, retry, `/api/queue-operations`, `/api/tool-actions`, failed Queue-job replay, and approved-action retry/cancel
- Human review: `/api/approvals`, validated assignee directory/assignment, collaboration messages, information request/response, escalation, approve/decline
- Evidence: `/api/audit`, `/api/logs`, `/api/governance`, `/api/governance/export`, `/api/governance/privacy-report`
- Integration intake: `/webhooks/:endpointId`, `/api/webhooks`
- Operational delivery: `/api/notifications`, policy configuration, and signed delivery tests
- Knowledge: `/api/knowledge-sources`, reindex/removal, and `/api/knowledge/query`
- Incident operations: `/api/incidents`, lifecycle transitions, `/api/tenant/mode`, and process containment/recovery
- Quality controls: `/api/evaluations/:id`, curated cases, exact-release runs, and publish gates
- Operations: `/health`, `/api/overview`, `/api/system/capabilities`

Role checks are attached at the route boundary and repository queries remain tenant-scoped.

The customer-facing privacy and architecture report is a printable, self-contained HTML download with a machine-readable JSON option. It inventories configured processes and owners, Cloudflare services and storage, model profiles, knowledge and webhook inputs, retention/deletion rules, external destinations, connection scopes and credential readiness, typed tools, human oversight, release versions, logging/export behavior, subprocessors, readiness controls, and explicit limitations. The report selects no credential ciphertext or secret values, emits `no-store` and `nosniff`, uses a restrictive Content Security Policy, and HTML-escapes tenant-controlled content. The existing governance JSON remains available as lower-level evidence.

Connection operations distinguish configuration from evidence: “credential configured” means secret metadata exists, “last health check” is the latest explicit or provider-backed check, and “last successful use” advances only after a real provider request succeeds. Operators can assign an eligible same-tenant rotation owner and record credential expiry/last rotation dates. The daily Cron emits an in-app warning for configured credentials within 30 days of expiry and marks expired connections for attention. Cloudflare Workers AI is shown as an account binding rather than a customer credential; Microsoft delegated OAuth is provider-rotated and can record an explicit organizational expiry when one applies. Generic connectors remain visibly metadata-only until a provider-specific live probe exists.

The opportunity backlog separates customer discovery from agent deployment. Operators can capture the observed manual steps, systems, exceptions, volume, handling time, labor assumption, rework rate, data class, business risk, human judgment, and whether the process changes another system. Workrr calculates impact from volume, monthly human effort, estimated labor, and rework; feasibility is scored separately from integration count, exceptions, judgment, data sensitivity, risk, and external writes. The combined 60/40 priority is visible decision support—not automatic authorization. Builders and owners record qualification evidence, approve or decline candidates, and can convert a qualified candidate through the same process factory used by onboarding. Conversion is idempotent and creates a paused blueprint, draft prompt/release, release-gate evaluation, typed tool starting points, and baseline value record; it never launches autonomous work.

Every opportunity also produces a printable, secret-free forward-deployed engineering brief. It carries the captured current state and assumptions, score method, minimum control posture, open discovery questions, implementation checklist, acceptance gates, and conversion lineage. The runtime recommendation explicitly distinguishes ephemeral instant Workers, thread-sticky Agents SDK Durable Object actors, and execution-sticky Cloudflare Workflows; it describes D1 as searchable control/evidence storage rather than repeated conversational memory or long-running compute. Both printable HTML and JSON responses are tenant-authorized, `no-store`, and exclude prompt content, credentials, provider tokens, and customer records.

Captured opportunity evidence is revisioned instead of overwritten. Every correction requires a reason, writes a complete tenant-scoped immutable snapshot, increments an optimistic revision number, and resets the candidate to `captured` so an earlier qualification cannot authorize materially changed facts. Stale saves fail with a conflict and require a reload. Converted opportunity evidence remains immutable and retains its process lineage; authorized viewers can inspect the revision timeline without changing it.

Delivery readiness is explicit and attributable. Business-owner confirmation, current-state/baseline validation, data-classification confirmation, and target-outcome approval must each have a same-tenant owner plus specific evidence before conversion can create a process. Systems ownership, exception/stop conditions, acceptance examples, and the operational support path are tracked separately as release-planning evidence: they do not prevent safe paused-draft creation, but remain visible in the FDE brief and process handoff. Material opportunity revisions reopen every check while preserving assigned owners and due dates. The server rechecks the four conversion gates; disabling a browser button is not the authorization control.

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
20. `0020_microsoft_oauth.sql`: delegated Microsoft OAuth state, encrypted credentials, and connection lifecycle.
21. `0021_dlp_policies.sql`: tenant DLP rules and boundary evidence.
22. `0022_evaluation_rubric_templates.sql`: reusable organization quality standards.
23. `0023_service_principals_and_smoke_fixtures.sql`: Access machine identities and disposable live probes.
24. `0024_governed_rubric_packages.sql`: signed standards review and destination approval evidence.
25. `0025_rubric_publisher_trust.sql`: tenant publisher keys and manual, automatic, or blocked trust policy.
26. `0026_process_schedules.sql`: tenant recurring-process controls and per-occurrence dispatch evidence.
27. `0027_queue_operations.sql`: application-level Queue lifecycle, retry/dead-letter evidence, and replay lineage.
28. `0028_microsoft_email_notifications.sql`: disabled-by-default operational email routes for Microsoft Graph delivery.
29. `0029_knowledge_center.sql`: R2/Vectorize source lifecycle, chunk provenance, retrieval diagnostics, and index evidence.
30. `0030_knowledge_evidence.sql`: immutable execution-to-source citation evidence for grounded run inspection.
31. `0031_process_contracts.sql`: immutable release input/output schemas and per-execution validation evidence.
32. `0032_progressive_autonomy.sql`: effective autonomy snapshots, dispositions, and execution-linked approval evidence.
33. `0033_typed_tools.sql`: tenant tool catalog, process bindings, immutable release policies, and per-run tool evidence.
34. `0034_tool_invocations.sql`: idempotent model tool-call evidence and explicit simulation/proposal/bound execution modes.
35. `0035_bound_tool_adapters.sql`: registered implementation keys and fixed-endpoint Microsoft read tools.
36. `0036_approved_tool_actions.sql`: approval-linked Queue dispatch lifecycle and the fixed-endpoint Microsoft calendar write tool.
37. `0037_approval_collaboration.sql`: attributable review discussion, information-request state, escalation level, and activity evidence.
38. `0038_connection_lifecycle.sql`: credential expiry, rotation ownership, last-success evidence, truthful health detail, and expiry notification policy.
39. `0039_process_opportunities.sql`: pre-build manual-process intake, transparent prioritization evidence, qualification lifecycle, and conversion lineage.
40. `0040_opportunity_revisions.sql`: immutable discovery snapshots, correction reasons, optimistic concurrency, and qualification-reset evidence.
41. `0041_opportunity_readiness.sql`: owned conversion gates, release-planning evidence, due dates, and auditable readiness decisions.
42. `0042_notification_response.sql`: in-app response ownership, attributable acknowledgement, and escalation evidence.
43. `0043_notification_quiet_hours.sql`: external-delivery quiet windows, critical bypass, scheduled release, and idempotent Queue claims.
44. `0044_notification_digests.sql`: hourly/daily email aggregation, digest lineage, item counts, and provider-result propagation.
45. `0045_managed_lifecycle.sql`: support/recovery ownership, maintenance window, recovery-review timing, and audited handoff configuration.
46. `0046_process_retirement.sql`: governed retirement state, legal hold, disposal scope, independent approval, scheduling, and immutable disposal evidence.
47. `0047_tenant_retention_controls.sql`: tenant lifecycle periods, legal hold, daily enforcement state, and auditable content-expiry evidence.
48. `0048_billing_reconciliation.sql`: normalized Cloudflare billing evidence, estimate variance, checksum idempotency, and non-destructive correction history.
49. `0049_rubric_key_rotation.sql`: publisher key validity, predecessor-signed successor proofs, tenant rollover approval, overlap evidence, and expiry state.
50. `0050_learning_center.sql`: tenant- and actor-scoped, versioned training acknowledgement evidence.
51. `0051_help_operations.sql`: tenant support-request lifecycle, response ownership, notification policy, training oversight, and help-content retention.

Development migrations are applied before each matching development deploy. Production migration remains an explicit reviewed release action.

## Environments and deployment

| Environment | Worker | Domain | Branch | State |
| --- | --- | --- | --- | --- |
| Development | `workrr-platform-dev` | `one-dev.workrr.ai` | `dev` | Auto-deploying and Access-protected |
| Production | `workrr-platform` | `one.workrr.ai` | `main` | Access-protected; promoted from reviewed dev releases |

Cloudflare Workers Builds owns deployment. GitHub Actions must not duplicate it. Non-production branch builds are disabled to control build usage.

Before each production promotion, run `npm run promote:production` for a non-mutating plan. Apply mode requires the exact full `origin/dev` SHA plus `--confirm production` and automates the following contract:

1. Verify the production Access application and explicit customer allow policy.
2. Verify the production `ACCESS_TEAM_DOMAIN` and production-specific `ACCESS_AUD`; never reuse dev's audience.
3. Validate tenant memberships and least-privilege roles.
4. Configure `WEBHOOK_INBOX_SECRET` and `NOTIFICATION_WEBHOOK_SECRET` with `wrangler secret put`; never place values in D1 or Git.
5. Inventory and apply pending D1 migrations to the production database.
6. Run typecheck, tests, build, and a dry-run deploy without a bypass flag.
7. Fast-forward `main` to the exact reviewed `origin/dev` commit without checking out or rewriting either branch.
8. Wait for Cloudflare Workers Builds to report success for that exact commit, then verify the Worker version and Workrr Access redirect.

## Verification contract

Run for every release:

```bash
npm run typecheck
npm test
npm run build
```

For changes to identity, tenant scoping, release publication, approval decisions, replay, or webhook handling, add endpoint-level tests before promotion. A successful frontend build alone is not adequate evidence.

The runtime suite proves that authenticated membership overrides forged tenant/role headers, cross-origin mutations are rejected before business writes, viewers cannot change administrative policy, tool definitions, containment, or customer baselines, onboarding retries do not duplicate processes, first processes start paused with draft releases, paused inputs are recorded as deferred, observe mode consumes zero model tokens, read-only and approval-only controls cap release autonomy, governed model tools are autonomy- and count-bounded, only ready low-risk mock reads simulate, consequential/unimplemented adapters remain proposal-only, fixed Microsoft reads cannot vary their Graph endpoints, an approved calendar write uses a fixed endpoint and provider idempotency without attendees, guarded tool policy evaluates typed risk/access/readiness, unavailable autonomous tools fall back to review, tenant drain/emergency stop blocks synchronous and queued admission, incident recovery requires containment evidence, inbound webhooks reject invalid/unapproved input and deduplicate delivery, outbound webhooks restrict destinations, sign envelopes, avoid duplicate delivery, and require configured credentials, Workflows persist token usage and terminal failures, durable identity keys remain sticky only within the intended scope, recurring schedules atomically claim before Queue handoff, and release-specific golden cases enforce expected/prohibited output assertions while capturing usage. These tests run locally with mocked model calls and no external deliveries.

Approval collaboration never broadens execution authority. Assignments resolve only to active, eligible members in the same tenant and persist a canonical email. Comments, information requests/responses, and escalations are attributable messages plus audit events. An outstanding information request disables and server-blocks approval until an authorized response returns the review to decision-pending; rejection remains available as the safe terminal choice. Escalation is capped at three levels, and none of these collaboration events creates a tool-action dispatch.

Interactive evaluation runs are deliberately limited to ten enabled curated cases per scenario. Durable suite runs load up to 100 cases and fan them into parallel, independently retriable Cloudflare Workflow steps before one deterministic aggregation step. They survive browser disconnection and persist their lifecycle separately from case evidence. DLP rules and model pricing are loaded once into prepared Workflow state rather than reread from D1 for every case. Each case can assign a case weight plus assertion weight and quality dimension (groundedness, completeness, safety, clarity, or format); the release evidence includes both the overall gate score and per-dimension scores. Model trials execute the immutable release prompt and identical cases once with the release baseline profile and once with a candidate Cloudflare profile; both arms are costed and scored without changing the live process or release-gate state. Every model call participates in the tenant hard budget.

Evaluation scenarios export as a versioned `workrr-evaluation/v1` JSON package containing the gate threshold, anonymized inputs, deterministic assertions, dimensions, and weights. Imports merge by case name, skip duplicates for safe retries, enforce the 100-case bound, apply the destination tenant's current DLP policy before any case is persisted, invalidate prior gate status, and emit an audit event. Viewers may export packages, while only owners, admins, and builders may import them.

Model grading is optional and additive to deterministic assertions. A case may define up to three short rubric criteria and uses one secondary `fast` Cloudflare Workers AI call to score all of them. Candidate output is treated as untrusted data; the judge is instructed to return compact JSON scores and brief evidence without hidden reasoning. Judge input and output cross the tenant DLP boundary, judge tokens and estimated cost are added to the case ledger, a score of at least 0.8 passes a criterion, and no suite may contain more than 25 model-graded cases.

Usage reconciliation accepts normalized totals from a Cloudflare dashboard view, invoice, billing API response, or another verified source and compares native Workers AI charges with Workrr's captured model-rate estimate for the same inclusive period. The import stores numeric totals, a bounded evidence reference, and a checksum—not invoice files, credentials, or arbitrary provider payloads. Duplicate evidence is idempotent; corrections void the prior row with a required reason instead of deleting history. This is intentionally a manual evidence boundary today: Cloudflare's account billing-usage API exposes selected Workers/platform counters but not native Workers AI neuron charges, while AI Gateway unified billing applies to third-party models rather than `@cf/*` Workers AI models. A future connector can write the same normalized schema without changing the ledger or UI.

Signed organization standards support scheduled Ed25519 publisher-key rollover through `workrr-rubrics/v3`. The current key signs the package while the previous key signs a canonical successor proof limited to the publisher name, both key fingerprints, the successor public key, and its validity window. A destination accepts the handoff only when the exact predecessor key is already tenant-trusted and was valid when the proof was issued. An owner or administrator then approves or rejects the successor and selects a 0–30 day overlap; approval carries the predecessor policy to the successor, schedules predecessor retirement, and preserves both decisions. Package approval cannot bypass a pending key rotation, expired keys cannot auto-approve imports, and hourly Cron suspends expired trust with tenant audit evidence. Private keys remain Wrangler secrets and never enter D1 or portable packages.

Microsoft email notification policies are disabled by default. An owner must connect a delegated operating account with the explicit `Mail.Send` capability, configure exactly one validated recipient per policy, and then enable or test the route. Queue workers obtain short-lived access tokens from the encrypted rotating refresh token and call Microsoft Graph `/me/sendMail`; refresh tokens and access tokens are never returned to the browser, logged, or stored as notification evidence. Graph HTTP 202 is recorded as provider acceptance, not proof of final mailbox delivery.

In-app notifications and external notification deliveries are intentionally different records. In-app policy rows may name an active tenant owner, administrator, or operator, require attributable acknowledgement, and define a one-minute-to-seven-day response SLA. The hourly Cron scans a bounded set of overdue unacknowledged events, conditionally claims each original event, and writes immutable critical escalation and audit evidence. The system-generated escalation event is already marked as system acknowledgement so it cannot recursively escalate. Webhook and email rows record delivery attempts and provider acceptance only; users cannot acknowledge them as if delivery proved human response.

External email and webhook policies may define a UTC quiet window and whether critical events bypass it. Noncritical events created during the window are persisted immediately as pending evidence but are not placed on Queue until the window ends; the hourly maintenance trigger conditionally claims and releases at most 100 due deliveries. Critical bypass is enabled by default. Test sends intentionally bypass quiet hours because an administrator explicitly requested the test.

Email policies additionally support immediate, hourly digest, or daily digest delivery. Due digest items are claimed together per tenant and policy, linked by an opaque batch ID, and represented by one synthetic delivery event containing a bounded summary and item count. Only that synthetic event enters Queue and calls Microsoft Graph. Provider acceptance or terminal failure propagates to the included item evidence without erasing the digest lineage. A claim mismatch or Queue-send failure releases the original items for a safe later attempt. Webhooks remain event-by-event because batching would change their integration contract. Critical events configured to bypass controls remain immediate even when the policy otherwise uses digests.

Customer Setup includes a tenant-scoped managed-lifecycle center for the operating team that remains after FDE handoff. Administrators and owners assign active same-tenant support and recovery owners, escalation contact, UTC maintenance window, recovery-review due date, and bounded support notes. Its preflight derives readiness from live profile, retention, notification ownership, credential lifecycle, enabled external routes, active published releases, critical incidents, and Cloudflare Access configuration rather than a manually checked list. Operators may download a no-store redacted support bundle; viewers may inspect readiness but cannot mutate settings or export the bundle. The bundle intentionally omits credentials/tokens, notification destinations, prompts, knowledge content, execution payloads, member emails, and API bodies.

Process Studio exposes retirement as a governance workflow rather than a delete button. A builder, owner, or administrator must enter the exact process name and a bounded rationale; Workrr immediately pauses the process and every recurring schedule and disables its webhook ingestion. A different owner or administrator must approve irreversible disposal, with an explicit time 24 hours to 90 days in the future. Legal hold blocks approval and Cron dispatch until an owner explicitly releases it. Cron atomically claims due work and Queue performs the disposal outside the request Worker: it clears up to 1,000 known Agent SDK durable actors in bounded parallel groups, redacts selected execution/approval/prompt content, preserves configuration metadata and the audit log, and records count-based disposal evidence. Knowledge sources are never deleted implicitly because they may be shared across processes. A deployment exceeding 1,000 durable actors fails closed and requires the planned batched disposal Workflow.

Governance also provides tenant-wide retention operations with separate bounded periods for Agent conversations, execution content, approval content, notification detail, and API logs. Preview is read-only and shows eligible content before enforcement. An owner or administrator can apply a tenant legal hold with a reason; release requires an exact confirmation, and process-specific legal holds remain authoritative even when tenant cleanup runs. Hourly Cron considers each tenant at most once per day, redacts content rather than destroying operational identities, deletes expired API metadata, preserves audit events, and records count-based enforcement evidence. Conversation cleanup calls the correct sticky Agent actor in bounded groups; more than 200 actors fails closed for a future batched Workflow instead of extending one Worker invocation.

Knowledge source bytes never use D1 as a content cache. Workrr applies the tenant input-DLP policy before storing the approved representation in R2, records only lifecycle/provenance metadata in D1, and hands embedding work to Queue. Vectorize stores embeddings in a tenant namespace and requires both tenant metadata filtering and a tenant-scoped D1 chunk join before an R2 chunk is returned. Process bindings are enforced during retrieval. Durable actors, instant execution, and Workflows all call the same bounded retrieval path; retrieved text is delimited as untrusted reference material and does not become conversation memory. Each successful retrieval stores at most five safe citation excerpts, match scores, and source provenance against the tenant execution so Activity can prove grounding without rereading R2. Cron marks expired reviews stale and stale sources are excluded from retrieval until an owner, administrator, or builder reviews them. Removing a source deletes its D1 catalog, R2 original/chunks, and Vectorize records while previously captured execution citation evidence remains attributable.

Process releases may carry optional, bounded JSON Schema input and output contracts. They are normalized into the immutable compiled release, included in its checksum and portable package, and become active only through the existing evaluation-gated publish path. Input validation occurs after DLP transformation but before Workers AI, including API, signed webhook, recurring schedule, Queue, replay, instant, durable actor, and Workflow entry paths. Output contracts add an explicit JSON-only model instruction, then validate the post-DLP response before it is persisted to durable conversation memory or exposed as a business result. Activity records the exact release and input/output contract status. Contract-free releases preserve the simpler text behavior.

Organizations may maintain up to 20 tenant-scoped rubric templates, each containing one to three weighted quality criteria. New tenants receive actionable operations, safe communication, and structured handoff templates. Builders can create, archive, and restore templates in the Evaluation Lab; viewers can inspect them. Applying a template copies its criteria into the golden case rather than retaining a live reference. That preserves historical evidence, prevents later template edits from silently changing an existing release gate, and avoids a template lookup on every evaluation case execution. Case creation uses one consolidated scenario/count query, an additional D1 read only when a template is selected, and a batched case/scenario write.

Rubric libraries export as `workrr-rubrics/v1` packages containing only names, descriptions, bounded criteria, dimensions, weights, and prior activation state. Tenant IDs, D1 IDs, actors, credentials, and secret values are excluded. Destination imports merge idempotently by case-insensitive name, reject sensitive content and packages beyond the 20-template ceiling, write new rows in one D1 batch, and keep every imported template archived until a destination administrator explicitly reviews and restores it. Viewers may export standards; only owners, admins, and builders may import them.

Production inputs are never sampled automatically. An authorized user may explicitly promote only the already-stored, truncated execution preview into a case. Before persistence, Workrr masks common email, phone, SSN, payment-card, and secret-token patterns and records redaction counts/types. This is a safety net, not a substitute for customer data-classification policy or a full DLP engine. Much larger batch datasets should add Workflow fan-out rather than extending one inference step indefinitely.

The Help Center turns the platform's implementation boundaries into customer-operable guidance. Each signed-in user receives a short learning path selected by their server-resolved tenant role, with versioned acknowledgement evidence scoped to that tenant and actor. Administrator, builder, owner, operator, reviewer, viewer, and consumer guidance uses different first actions and escalation paths. Plain-language concepts distinguish instant agents from Agent SDK durable actors, Workflows, Queues, and approval records. Live process runbooks are derived from tenant process/discovery data and state the owner, status, autonomy, operating steps, exception path, and exact memory behavior for that execution profile. Documentation remains code-versioned while D1 stores only compact acknowledgement evidence and dynamic tenant reporting; it does not add a per-request content cache.

Help is also an accountable operating workflow. Any authenticated member can create a bounded how-to, unexpected-result, access, incident, or privacy request and optionally link an exact same-tenant process or execution. Incident and privacy requests are always high priority; high, normal, and low work receives a four-hour, one-day, or three-day due time. New work auto-assigns to the configured support owner when available and emits the tenant's in-app help notification. Builders, operators, owners, and administrators may assign or transition work; resolution requires evidence, uses optimistic revision checks, and becomes immutable. Other roles see only their own requests. Administrators and owners see current-version training completion for active tenant members. Help content has its own configurable retention period, respects tenant legal hold, and is redacted while request identity and audit evidence remain.

## Remaining aggressive-MVP work

The foundation is usable, but these are the highest-value next slices:

1. Register and credential the first customer Microsoft Entra application. The provider-specific lifecycle is implemented with delegated PKCE authorization, capability-scoped consent, encrypted refresh-token persistence, rotation-aware health checks, and disconnect/reconnect controls.
2. Provision a least-privilege Cloudflare Access service token for each environment, register its Client ID as an operator service principal, and run the implemented `smoke:live` command. It authenticates through Access, validates tenant identity and read surfaces, and creates/reads/deletes a ten-minute tenant-scoped fixture with failure cleanup. Promotion already provides dry-run planning, clean/fast-forward Git gates, exact-SHA confirmation, required-secret inventory, mandatory verification, ordered D1 migrations, Cloudflare build polling, Worker version evidence, and Access redirect verification.
3. Expand the current identity, tenant, role, OAuth replay/encryption, package, durable-stickiness, Workflow accounting, webhook-deduplication, Access-handoff, lifecycle-preflight, and promotion tests into those live-environment smoke tests.

Each slice should preserve the core boundary: D1 controls configuration and reporting, durable actors own sticky conversational state, Workflows own long-running orchestration, and Queues own burst absorption.
