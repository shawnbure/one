# Cloudflare Agent Framework — Deep Product and Architecture Review

Date: 2026-07-22  
Status: Product direction recommendation  
Reviewed inputs: `gmpro-49` `ai-runner` and `ai-agent`, the Reclaira webhook/workflow/API-log/auth patterns, the current technical outline, and current Cloudflare Agents platform guidance

> **Product scope companion:** [`mid-market-private-ai-product-requirements.md`](./mid-market-private-ai-product-requirements.md) defines the aggressive MVP for mid-market SMB customers. It supersedes the narrower “Customer Operations Agent only” framing where the two documents differ, while retaining Customer Operations as the first reference solution pack.

## Executive conclusion

There is a real product here, but the product should not initially be “a universal AI agent platform.” You do not yet have a single universal customer problem, and building the entire platform described in the technical outline would create a large surface before the highest-value abstractions have been proven.

The strongest product is:

> An opinionated Cloudflare Agent Deployment Kit for forward-deployed engineers, shipped with one excellent Customer Operations Agent application.

The kit turns the repeated infrastructure and operational work from existing customer implementations into reusable primitives. The reference application proves those primitives through a complete customer-facing workflow:

- receive a message, request, or webhook;
- continue a durable agent conversation;
- retrieve customer knowledge;
- call typed customer tools;
- request approval for consequential actions;
- perform background work through Cloudflare Workflows;
- record every model, tool, webhook, and API interaction;
- let an operator inspect, replay, and resolve failures; and
- package the configuration for repeatable deployment and handoff.

This is more valuable than publishing the existing runner/agent design as boilerplate. The existing design contains strong working behaviors, but the reusable product is the operating model around those behaviors: deployment, configuration, state, safety, observability, testing, and customer handoff.

## 1. What has already been validated

The existing projects demonstrate several genuine needs rather than speculative features.

### 1.1 Agent orchestration is real

`gmpro-49` already performs classification, selective prompt loading, retrieval, response generation, structured extraction, parallel agent work, summaries, and application writes. This validates the need for:

- reusable turn admission;
- typed context assembly;
- prompt composition;
- model profiles;
- structured tools;
- background and parallel work;
- deterministic versions; and
- failure-aware orchestration.

The current runner/agent boundary, however, is an implementation artifact rather than a product concept. Both Workers own overlapping prompt, RAG, context, and model behavior. The framework should preserve the useful behaviors and remove the public split.

### 1.2 Prompt operations are real

The `gmpro-49` admin UI validates that customers and operators need:

- draft and published prompt states;
- readable labels rather than implementation keys;
- model and agent controls;
- per-prompt knowledge bindings;
- preview and test behavior;
- safe publication; and
- rollback/history.

The evolved framework should make these release concepts first-class rather than synchronize two prompt stores.

### 1.3 Knowledge operations are real

The dataset UI validates practical needs that simple “connect Vectorize” examples omit:

- dataset creation and metadata;
- file, row, and pasted-text ingestion;
- progress and failure handling;
- query testing and raw-hit inspection;
- counts and index diagnostics;
- safe clearing/deletion; and
- binding knowledge to agent behavior.

This is worth preserving, but knowledge ingestion should not block the first vertical slice. Agent behavior, tools, approvals, and traces are the product’s critical path.

### 1.4 Operational control is real

Reclaira validates the need for:

- inbound webhook receipts and idempotency;
- unified inbound/outbound API logs;
- workflow definitions, runs, and step-level history;
- manual, event, schedule, and webhook triggers;
- searchable failure information;
- retention policies; and
- roles and managed permissions.

These are “maturity” features that distinguish a customer-ready system from an agent demo. They should be central to the application.

## 2. Product thesis

### 2.1 The product is an operating kit, not an agent abstraction library

Cloudflare already supplies the core agent runtime. Competing with the Agents SDK by wrapping every API would create maintenance burden and hide useful platform capabilities.

The framework should provide the missing opinionated layer:

- customer deployment convention;
- application and data contracts;
- secure integration patterns;
- prompt and agent release management;
- tool risk and approval policies;
- run/API observability;
- test and evaluation harnesses;
- administrative UX;
- solution-pack conventions; and
- FDE implementation and handoff workflow.

Use the Agents SDK directly wherever it already provides the behavior.

### 2.2 The first application is Customer Operations Agent

“Customer Operations” is intentionally broad enough to fit current customers but concrete enough to build. It covers support, intake, qualification, collections, scheduling, sales follow-up, document processing, and internal operations without pretending they are identical products.

The reference application should demonstrate:

1. A conversation or inbound event creates a durable Agent session.
2. The Agent uses a published prompt release and model profile.
3. It reads customer context through a typed tool.
4. It retrieves bounded knowledge when relevant.
5. It proposes or executes an action according to policy.
6. A consequential action pauses for approval.
7. A Workflow performs durable multi-step work.
8. The operator sees a complete timeline and API log.

Every framework feature must first make this flow easier, safer, or more observable. Features without a reference-application use case stay out of v1.

### 2.3 Deployment is the initial differentiator

The target outcome is not “create an agent.” It is:

> Deploy, configure, verify, operate, and hand off a customer agent in days rather than rebuilding the platform for each customer.

Time-to-first-safe-run and time-to-customer-handoff should be primary product metrics.

## 3. Recommended product boundary

### 3.1 Build now

- Cloudflare Agents SDK-native conversation runtime.
- One customer deployment per Cloudflare environment by default.
- Tenant-aware records and contracts to avoid future lock-in, without building a full multi-tenant SaaS control plane.
- Prompt drafts, validation, immutable releases, activation, and rollback.
- Curated Workers AI model profiles.
- Typed local tools with read/write/external-message/destructive risk levels.
- Persistent tool approvals using the SDK’s chat approval capabilities where applicable.
- Webhook verification, receipt logging, idempotency, and replay.
- Agent Workflow integration for durable pipelines.
- Complete run timeline and unified inbound/outbound API log.
- Three useful roles: administrator, builder, and operator/viewer.
- A polished but form-driven Agent Studio.
- One reference solution pack and one small example pack.
- Local tests, deployment automation, health checks, and handoff documentation.

### 3.2 Design extension points now, implement later

- AI Gateway inference provider.
- Remote MCP integrations.
- Cloudflare Access/OIDC enterprise adapters.
- Multiple knowledge providers.
- Evaluation gates and A/B releases.
- Multi-deployment fleet management.
- Optional shared SaaS control plane.
- Background sub-agents.
- Code Mode, Browser, Voice, and Sandbox-based tools.

These should have interfaces or reserved metadata only when doing so is inexpensive. Do not add inactive infrastructure for them.

### 3.3 Explicitly defer

- General drag-and-drop workflow authoring.
- Arbitrary graph loops.
- A plugin marketplace.
- Customer-authored executable code.
- An unrestricted model catalog.
- Automatic multi-provider optimization.
- Database-per-tenant orchestration.
- Custom billing and subscription management.
- A generalized business ontology.

## 4. Architecture review

### 4.1 Agents must remain Agents SDK-native

The framework should subclass `AIChatAgent` for the primary conversation use case and use the SDK’s client transport, message persistence, resumable streaming, callable methods, schedules, retries, connection controls, and diagnostics events.

Do not recreate:

- chat message storage;
- WebSocket reconnection;
- stream resumption;
- tool approval persistence;
- scheduling tables;
- Workflow tracking;
- generic Agent routing; or
- SDK lifecycle observability.

Custom code should begin at the customer-specific seams: prompt assembly, tool registry, policy, integration adapters, business events, and product-level traces.

The framework may provide a thin `CustomerOperationsAgent` base class, but it must remain recognizable as a Cloudflare Agent rather than introduce a competing lifecycle.

### 4.2 Correct runtime model

Agents are durable identities with ephemeral compute:

- a name routes events to the same Agent;
- local SQLite and Agent state survive hibernation and eviction;
- memory, timers, open fetches, and closures do not;
- the Agent wakes for a turn or event and returns to sleep;
- `AIChatAgent` protects active model streaming;
- `keepAlive` is a bounded execution aid, not hosting;
- fibers recover Agent-centric operations after eviction; and
- Workflows own independent multi-step pipelines.

The application must never rely on a warm isolate cache for correctness or its normal cost model.

### 4.3 Recommended identity topology

Do not treat one agent definition as one actor. A published definition is a blueprint that can create many runtime actors. Use one name-addressed Agent per conversation/session as the default conversational topology:

```text
{deploymentId}:{agentDefinitionId}:{sessionId}
```

This aligns with Cloudflare’s session model and provides isolated SQL, ordered turns, independent scaling, and clean retention/deletion.

Definitions must declare an execution profile:

- Conversation-sticky: one actor per threaded conversation.
- Consumer-sticky: one actor per user/customer across intentional multiple threads.
- Entity-sticky: one actor per case, account, project, order, device, or monitored resource.
- Shared/sharded: deterministic actor shards for high-volume coordination.
- Temporary durable: one recoverable actor per run, removed under a retention policy.
- Instant/stateless: direct Worker inference or processing with no Agent instance.
- Workflow: a Workflow instance for durable steps, waits, retries, and approvals.

All actual Agents SDK instances are Durable Object-backed actors. “Instant agent” is a UI/product label for stateless processing; it must not create an Agent merely to avoid using its durability.

Do not use one tenant-wide conversation Agent for all users merely to share prompt configuration. It creates unnecessary contention, mixed retention boundaries, and more complex authorization.

The runtime router—not the browser—constructs canonical Agent names from authenticated tenant context plus the profile key. This guarantees that threaded consumers remain sticky and prevents callers from crossing instance or tenant boundaries.

### 4.4 Prompt storage and D1 economics

The no-KV design remains reasonable and simpler:

- D1 stores one immutable compiled bundle row per prompt release.
- Session creation selects the exact active bundle through an indexed key.
- That bundle is passed to and persisted inside Agent SQLite.
- Normal turns and post-eviction activations use Agent-local SQL.
- Existing conversations stay pinned; new conversations use the active release.

D1 meters rows scanned/read. Therefore, do not assemble the prompt through several runtime joins or read every module during session creation. Compile and validate at publish time, then select exactly one indexed bundle row at session creation.

Record `rows_read` from D1 query metadata during benchmarks. The design target is one prompt-bundle row read per new session, zero prompt D1 reads per normal turn, and zero prompt D1 reads for a normal Agent reactivation.

### 4.5 D1 should not become the high-volume event stream

D1 is appropriate for searchable definitions, run summaries, approvals, webhook receipts, and moderate operational logs. It should not automatically store every streamed token or verbose diagnostic payload as a row.

Recommended split:

- Agent SQL: conversation messages and session-local events.
- D1: cross-session indexes, run summaries, approvals, API attempts, searchable errors, audit events.
- R2: full large/redacted payloads, exports, source documents, and retained trace artifacts.
- Workers observability/diagnostics channels: platform lifecycle and debugging events.
- Analytics Engine or Pipelines later: high-cardinality aggregate telemetry if volume demands it.

### 4.6 Workflow boundary

Do not port Reclaira’s entire JSON workflow engine into v1. Use Cloudflare `AgentWorkflow` as the execution primitive and define workflows in TypeScript initially.

The admin application should display workflow structure, configuration, versions, and runs. A limited configuration surface may enable or parameterize known Workflow templates. General authoring comes later, after at least three customer workflows reveal a stable node model.

Use:

- Agent calls for quick reads and responses;
- Agent schedules for its own reminders and lifecycle;
- retries for short transient operations;
- fibers for recoverable Agent-owned work;
- Workflows for independent pipelines, durable steps, waits, and approvals.

### 4.6.1 Queues, schedules, and Cron

The mature framework should expose Cloudflare's execution primitives through one decision model rather than hide them behind a generic “background job” API.

- Use the Agents SDK local FIFO queue for asynchronous sequential tasks owned by one sticky Agent. The queue is stored in that Agent's SQLite and processes in the same actor context.
- Use Agent schedules for a specific Agent to wake at a future time or on a recurring cadence.
- Use Cloudflare Queues for cross-Agent event ingestion, traffic spikes, batching, independent fan-out, and load isolation. Queue delivery is at least once and not globally ordered, so consumers require idempotency and reconciliation.
- Use Workflows for dependent durable steps, waits, external events, retries, and approvals.
- Use Cron Triggers or scheduled Workflows only for deployment-wide periodic dispatch and maintenance. Cron should enqueue or start durable work and return quickly.

Example inbound path:

```text
Signed webhook
  → record receipt/idempotency
  → Cloudflare Queue
  → consumer derives canonical Agent identity
  → sticky Agent turn or stateless instant execution
  → Agent starts Workflow when durable steps are required
  → Workflow waits/retries/completes
  → Agent and operator UI receive progress
```

Example scheduled path:

```text
Agent-specific reminder → Agent schedule
Nightly deployment cleanup → Cron → Queue/Workflow
Large ingestion burst → Queue batches → Workflow per document or batch
```

The admin run timeline should present these transitions as one correlated execution rather than forcing the operator to understand several Cloudflare dashboards.

### 4.7 Model choice

Offer a curated set of capability profiles rather than every Workers AI model:

- Fast: classification, routing, extraction.
- Balanced: ordinary conversation and tool use.
- Reasoning: complex planning and analysis.
- Vision: image/document understanding.
- Embedding: retrieval ingestion and queries.

Each profile pins a tested model, supported features, context budget, output budget, and fallback behavior. An administrator may select among compatible profiles, while an FDE can edit deployment-level mappings.

The model selector must show practical attributes: tool calling, structured output, vision, context budget, expected speed tier, and enabled status. Avoid promising exact quality or cost rankings without your own evaluations.

### 4.8 Memory

Use stable SDK capabilities for v1:

- `AIChatAgent` message persistence;
- Agent SQL for summaries, explicit facts, and pending business state;
- bounded recent messages plus rolling summaries for context;
- Vectorize only for knowledge or long-term retrieval that truly needs semantic search.

Cloudflare’s Session/context-memory APIs are currently experimental. They are useful design inspiration, but the initial framework should not make an experimental package the foundation of customer data durability. Hide optional adoption behind a `MemoryProvider` interface after the basic Agent SQL implementation is proven.

### 4.9 Tools and MCP

Typed local tools are the best v1 integration primitive because an FDE can audit and test them with customer-specific service bindings and credentials.

Define tools as normal AI SDK-compatible tools with:

- runtime input/output schemas;
- timeout and retry policy;
- risk classification;
- permission and approval requirements;
- idempotency behavior;
- redaction metadata; and
- product trace hooks.

Add MCP as an adapter, not the internal tool abstraction. MCP is valuable when a customer already exposes an MCP server or when tools should be reused outside this application. Native tool code remains simpler for common customer deployments.

### 4.10 Authentication and roles

The Reclaira pattern is valuable, but the original four-role business model should not be copied directly.

Start with:

- Administrator: deployment, users, secrets, releases, destructive operations.
- Builder: agents, prompts, tools, workflows, knowledge, test runs.
- Operator: runs, approvals, replay, API log; no definition publishing by default.
- Viewer: read-only monitoring and reports.

Use permission capabilities behind these defaults so deployments can customize them. Apply the Agents SDK’s read-only connection controls for observers, while still enforcing every permission server-side.

For customer deployments, support two admin authentication modes:

1. Cloudflare Access for the simplest enterprise/internal deployment.
2. Native secure sessions for public/open-source demonstrations and deployments without Access.

Avoid implementing generic social login and full identity federation in v1.

## 5. The application experience

### 5.1 The admin should be operational before it is visual

The “slick graphic” should begin as a live topology and run map generated from real definitions—not a general drag-and-drop builder.

The first Agent Studio should include:

- Agent overview with current release, model profile, tools, knowledge, and health.
- Prompt editor with modules, token estimates, diff, validation, test, publish, and rollback.
- Tool catalog with risk badges, schemas, secrets readiness, and test status.
- Workflow topology generated from registered Workflow metadata.
- Test console with streaming output and trace inspection.
- Live run timeline showing prompt selection, retrieval, model calls, tools, approvals, and external APIs.
- Approval inbox.
- Unified API log with inbound/outbound direction, replay, redaction, and correlation.
- Deployment readiness checklist.

This is already a differentiated application. A full editable canvas is not required to make it compelling.

### 5.2 The most valuable visual

The signature visual should be a combined topology and execution view:

```text
Webhook / Chat
      ↓
Customer Operations Agent ── Knowledge
      ↓                         │
Read Customer Tool             │
      ↓                         │
Model Decision ◀───────────────┘
      ↓
Approval Required
      ↓
Durable Workflow → External API
```

In design mode it shows versions, bindings, permissions, and readiness. During a run, the same graph lights up node by node with duration, status, input/output previews, retries, and errors. This connects configuration to operations and will make excellent demonstration content.

### 5.3 Deployment readiness is a feature

Before publication, show a checklist:

- Worker bindings configured;
- D1 migrations current;
- required secrets present;
- model profiles available;
- prompt release valid and within budget;
- tool schemas valid;
- webhook signatures configured;
- knowledge index ready;
- approval owners assigned;
- smoke tests passing;
- retention policy selected.

This is especially useful to FDEs and reduces incomplete handoffs.

## 6. Reference solution pack

The first solution pack should be deliberately generic but complete.

### Customer Operations Starter

Inputs:

- chat message;
- generic signed webhook;
- manual operator test.

Tools:

- `lookup_customer` — read-only;
- `search_customer_records` — read-only;
- `create_follow_up` — write, idempotent;
- `send_customer_message` — external-message, approval by policy;
- `escalate_to_human` — write/notification.

Knowledge:

- company information;
- policies;
- FAQs;
- product/service reference.

Workflow:

- receive event;
- normalize and deduplicate;
- create or resume Agent session;
- perform read tools;
- respond or propose action;
- wait for approval if required;
- execute durable follow-up;
- record completion and outbound API attempt.

The pack must include mock adapters and seed data so it works immediately after local setup. Customer adapters replace mocks without changing the Agent or Workflow lifecycle.

## 7. Open-source package strategy

Avoid publishing many tiny packages before the API stabilizes. Start as one monorepo and expose a small public surface:

- `@project/contracts`
- `@project/agent-runtime`
- `@project/toolkit`
- `@project/testing`

Keep control-plane repositories, UI, and deployment scripts inside the application until repeated external use proves they should be packages.

The open-source repository should include:

- one-command local startup;
- a guided Cloudflare provisioning script;
- generated binding types;
- seed data and mock tools;
- the Customer Operations Starter;
- architecture and threat-model documentation;
- upgrade/migration guidance;
- screenshots or a hosted demo; and
- a clear “bring your own customer adapter” tutorial.

## 8. Revised delivery recommendation

### Milestone 1 — Framework proof

Build only the server/runtime foundation:

- Agent SDK-native chat session;
- one D1 prompt bundle read at initialization;
- Agent SQL persistence and eviction test;
- Workers AI profile;
- one read tool and one approval-gated write tool;
- structured run events;
- one Agent Workflow;
- webhook idempotency.
- Cloudflare Queue handoff with retry/DLQ behavior;
- one Agent-local queued task and Agent schedule;
- one global scheduled dispatcher that hands off work safely.

Success criterion: the same session survives eviction/reconnection and completes an approval-gated workflow with a reproducible trace.

### Milestone 2 — Deployable application

Add:

- admin authentication and four default roles;
- agent/prompt/model configuration;
- run timeline and API log;
- approval inbox;
- generated topology view;
- deployment readiness checks;
- local and Cloudflare deployment automation.

Success criterion: an FDE can deploy a fresh environment and hand it to an operator without using Wrangler or inspecting raw logs for normal operation.

### Milestone 3 — Customer adaptation

Use the framework for one real customer or refactor one current customer implementation onto it:

- replace mock tools with customer adapters;
- add the customer prompt and policies;
- add one customer Workflow;
- record every framework change that was required;
- distinguish framework fixes from customer-pack features.

Success criterion: at least 80% of the runtime, admin, deployment, and observability code remains unchanged for the next customer.

### Milestone 4 — Knowledge and publication

Add production knowledge ingestion, prompt evaluation cases, release comparison, and public documentation after the first customer adaptation validates the core.

### Milestone 5 — Generalization only from evidence

Add editable workflow nodes, MCP, AI Gateway, fleet management, or shared SaaS tenancy only when two or more customer implementations require the same capability.

## 9. Product validation without a single problem

You do not need to wait for a perfect horizontal problem, but the framework needs measurable hypotheses.

Validate these:

1. Can an FDE deploy the starter in under one hour?
2. Can an FDE replace mock tools with one customer API in under one day?
3. Can an operator identify why an agent acted within five minutes using only the admin application?
4. Can a prompt/model release be tested, published, and rolled back without a code deployment?
5. Can a failed webhook or external call be safely replayed?
6. Can a customer-specific solution pack avoid changes to framework core?
7. Can a second customer reuse at least 80% of the system?

These measurements reveal the product more reliably than adding a broad feature catalog.

## 10. Final feature priority

### Essential differentiation

1. Reproducible Agent sessions and releases.
2. Typed tools with risk and approval policy.
3. First-class run and API observability.
4. Webhook reliability and replay.
5. Agent Workflow integration.
6. Deployment readiness and handoff UX.
7. Curated Workers AI model profiles.
8. Prompt testing, publishing, and rollback.

### Valuable after the core

1. Knowledge ingestion and retrieval diagnostics.
2. Evaluation suites and release gates.
3. MCP adapter.
4. AI Gateway adapter.
5. Multiple solution packs.
6. Editable workflow templates.

### Likely distractions today

1. Universal visual workflow builder.
2. Full multi-tenant SaaS management.
3. Marketplace and arbitrary plugins.
4. Supporting every channel and experimental Agent feature.
5. Building a custom abstraction over the entire Agents SDK.

## Final recommendation

Proceed with the product, but narrow the first build.

Evolve `ai-runner` and `ai-agent` into one SDK-native Customer Operations Agent application. Treat the repeated customer seams—tools, prompts, releases, webhooks, workflows, approvals, logs, deployment, and handoff—as the framework. Keep customer business rules in solution packs. Make the live topology/run view the signature UX. Prove it by migrating or building one real customer deployment before generalizing further.

That path produces three useful assets at the same time:

- a mature internal accelerator for forward-deployed engineering;
- a credible open-source Cloudflare agent starter; and
- a polished reference application that is easy to demonstrate and create content around.
