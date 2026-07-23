# Mid-Market Private AI Operations Platform — Product Requirements

Date: 2026-07-22  
Status: Aggressive MVP product scope  
Target customer: Mid-market SMB without an internal software/AI development team  
Platform: Customer-controlled or dedicated Cloudflare deployment  
Implementation foundation: Cloudflare Agent Deployment Kit

## 1. Product position

The product enables an organization to identify, implement, govern, and operate private AI-assisted business processes without maintaining an internal development team.

The customer buys outcomes and operational confidence, not an agent framework. The framework is the delivery system used by the forward-deployed engineer to configure and extend those outcomes.

### Product promise

> Turn a manual business process into a private, measurable, human-governed AI process on the customer's Cloudflare environment, then operate it without requiring a development team.

### Why this product exists

Mid-market organizations often have:

- valuable but inconsistent manual processes;
- knowledge spread across documents, inboxes, spreadsheets, and business applications;
- no staff able to build and maintain agent infrastructure;
- concerns about confidential data entering general AI products;
- difficulty connecting AI to existing systems;
- uncertainty about which processes are useful and safe to automate;
- no reliable way to evaluate, approve, monitor, or roll back AI behavior; and
- executives who need evidence of business value rather than model activity.

The platform must close the gap between an AI demonstration and an owned business process.

## 2. Core product model: AI Process

The primary business-facing object is an **AI Process**, not an Agent or Workflow.

An AI Process represents one organizational outcome:

```ts
type AiProcess = {
  id: string;
  name: string;
  businessOwnerId: string;
  operatorGroupId: string;
  purpose: string;
  currentManualBaseline: ProcessBaseline;
  triggers: ProcessTrigger[];
  inputs: DataContract[];
  outputs: DataContract[];
  agentDefinitions: string[];
  instantTasks: string[];
  workflowDefinitions: string[];
  tools: string[];
  knowledgeBases: string[];
  humanCheckpoints: HumanCheckpoint[];
  policyBundleId: string;
  operatingMode: OperatingMode;
  successMetrics: MetricDefinition[];
  exceptionPolicy: ExceptionPolicy;
  retentionPolicyId: string;
  releaseId: string;
};
```

Agents, Workflows, Queues, Cron, schedules, tools, knowledge, and models appear as implementation components inside the process.

### Example processes

- Inbound customer-request triage and response.
- Quote or estimate preparation.
- Document intake, validation, and routing.
- Lead qualification and follow-up.
- Accounts receivable outreach and escalation.
- Service scheduling and confirmation.
- Purchase-order or invoice review.
- Employee onboarding and policy assistance.
- Compliance evidence collection.
- Case summarization and next-action recommendation.

## 3. Private AI definition

“Private AI” must be a demonstrable operating posture rather than a marketing label.

The product defines it as:

- a customer-owned Cloudflare account or a dedicated, contractually isolated deployment;
- customer-controlled identities, secrets, data stores, retention, and deletion;
- Workers AI as the default inference environment;
- customer content not used to train or improve models/services without explicit consent;
- explicit model and provider allowlists;
- no hidden external model calls;
- tenant/deployment-scoped knowledge and memory;
- least-privilege integration credentials;
- complete administrative and consequential-action audit history;
- configurable data classification and redaction;
- an export and deletion path;
- visible data-flow documentation; and
- a clear support-access policy.

The deployment readiness page must produce a downloadable privacy and architecture summary identifying:

- data inputs and sources;
- storage products and retention periods;
- models used;
- every external destination;
- credentials and permission scopes by reference, never value;
- human decision points;
- subprocessors/platform services;
- logging and export behavior; and
- current policy and release versions.

## 4. Users and jobs to be done

### Executive sponsor

- Select processes worth improving.
- Understand expected and realized business value.
- See risk, adoption, and exceptions without technical detail.
- Know who owns every deployed AI process.

### Process owner

- Describe how work happens today.
- Define acceptable outcomes and exceptions.
- Approve changes to process behavior.
- Review performance and employee feedback.

### Builder / forward-deployed engineer

- Map the manual process.
- Connect systems and knowledge.
- Configure agents, tools, policies, and workflows.
- Test and release safely.
- Extend the deployment with customer-specific code when required.

### Operator

- Work approvals and exception queues.
- Understand why a process stopped or escalated.
- Retry/replay safe work.
- Correct inputs and resume processing.

### Employee / consumer

- Start or participate in an AI process.
- See what the AI is doing and what it needs.
- Correct the AI or escalate to a person.
- Trust that organizational data remains controlled.

### Auditor / security reviewer

- Inventory AI systems and models.
- Inspect data flows, permissions, changes, and incidents.
- Export evidence and retention records.
- Verify human oversight and policy enforcement.

## 5. Product modules

### 5.1 Process Portfolio

An organizational catalog of AI opportunities and deployed processes.

Features:

- Process intake wizard.
- Manual-process baseline capture.
- Business owner and operator assignment.
- Department, sensitivity, risk, and lifecycle labels.
- Opportunity scoring.
- Status: idea, discovery, build, shadow, assisted, automated, paused, retired.
- Expected and realized value.
- Dependencies and connected systems.
- AI system/model inventory.
- Duplicate-process detection and template suggestions.
- Executive portfolio dashboard.

### Opportunity score

Score candidates using explainable inputs:

- frequency and volume;
- employee time per item;
- delay/cycle-time cost;
- error and rework rate;
- process consistency;
- data availability and quality;
- integration readiness;
- decision risk;
- regulatory/data sensitivity;
- exception frequency; and
- expected financial or service benefit.

The score recommends an implementation pattern; it does not automatically authorize automation.

### 5.2 Process Discovery Workspace

The FDE and process owner collaboratively document the current process before configuring AI.

Features:

- Guided interview/questionnaire.
- Current-state step map.
- Roles and handoffs.
- Inputs, outputs, systems, documents, and channels.
- Decision rules and examples.
- Known exceptions and failure cases.
- Existing service levels.
- Baseline volume, time, cost, and quality.
- Pain-point annotations.
- Record/sample upload with explicit sensitivity labels.
- Future-state proposal generated as a draft for human review.
- Discovery report and scope approval.

This workspace is a major differentiator for customers without technical staff. It converts consulting discovery into structured implementation data.

### 5.3 Process Studio

An operational configuration surface for a named process.

Initial Studio capabilities:

- Generated topology of triggers, agents, instant tasks, tools, queues, workflows, schedules, knowledge, and human checkpoints.
- Configuration inspector for supported components.
- Prompt modules and published releases.
- Model profile selection.
- Integration and permission binding.
- Human checkpoint policy.
- Exception routes.
- Test scenarios.
- Deployment readiness checklist.
- Release diff, approval, publish, and rollback.

The MVP topology is generated from typed definitions. Full arbitrary drag-and-drop programming is not required. Configuration forms may enable, disable, reorder, or parameterize supported template stages.

### 5.4 Work and Approval Inbox

Organizations without developers need one place for the human work created by AI processes.

Features:

- Unified assigned work queue.
- Approve, reject, edit-and-approve, request information, reassign, or escalate.
- Side-by-side source evidence and proposed action.
- Confidence and policy reason without implying unsupported certainty.
- SLA/due time and aging.
- Bulk action only where policy permits.
- Mobile-friendly approvals.
- Substitute/delegated approvers.
- Out-of-office routing.
- Comments and decision rationale.
- Full decision audit.
- Resume the waiting Workflow after a decision.

### 5.5 Operations Control Center

Features:

- Process health and throughput.
- Active, waiting, failed, and completed runs.
- Live correlated execution timeline.
- Queue depth, retries, and dead-letter items.
- Workflow waits and failures.
- Agent session health and reconnects.
- Inbound/outbound API log.
- Exception and escalation trends.
- Safe replay with idempotency preview.
- Pause process.
- Emergency stop for external writes/messages.
- Read-only safe mode.
- Roll back to prior release.
- Incident declaration and notes.
- Support bundle export with redaction.

### Operational modes

- `active`: normal configured behavior.
- `read_only`: AI may retrieve/analyze but cannot cause external writes.
- `approval_only`: every consequential action requires approval.
- `paused`: accept/record inputs but do not start new processing.
- `drain`: finish accepted work, reject or defer new work.
- `emergency_stop`: stop external actions and require administrator recovery.

### 5.6 Connections Hub

The platform must make integration ownership understandable to non-developers while leaving code extension points for the FDE.

Features:

- Connection catalog with status and owner.
- Guided credential setup.
- Required scope explanation.
- Secret readiness without displaying values.
- Test connection.
- Read versus write capability badges.
- Health checks and last successful use.
- Credential-expiry reminders.
- Webhook setup and signature verification.
- Typed HTTP/OpenAPI adapter.
- CSV/SFTP/import-export bridge for less mature customer systems.
- Email ingestion/sending adapter.
- Database adapter only through approved Cloudflare connectivity patterns.
- Local tool SDK for deep customer integrations.
- MCP adapter after core local tools are proven.

Each connection declares:

- systems/data it can access;
- action scopes;
- data classification allowed;
- responsible owner;
- rotation/expiry metadata;
- applicable processes;
- rate limits; and
- support instructions.

### 5.7 Knowledge Center

Features:

- Knowledge-base catalog and business owner.
- File, URL, text, structured-row, and integration ingestion.
- Source provenance and version.
- Sensitivity and allowed-process labels.
- Review/expiry date.
- Ingestion state and errors.
- Chunk and retrieval diagnostics.
- Test query with source evidence.
- Per-process binding.
- Stale-source alerts.
- Remove/reindex.
- Citation requirements.
- Permission-aware retrieval.

Knowledge is not automatically memory. A document source remains attributable and read-only unless an authorized process updates it through a tool.

### 5.8 Prompt, Model, and Behavior Releases

Features:

- Draft and published prompt modules.
- Immutable compiled release bundles.
- Human-readable diff.
- Token budget by section.
- Model capability compatibility.
- Scenario tests and expected properties.
- Tool-call simulation.
- Policy validation.
- Release notes and approver.
- Scheduled activation.
- Canary or limited audience later.
- Rollback.
- Existing conversation pin/migration policy.

The customer sees a “Process Release” that pins all component versions, not several unrelated deployment versions.

### 5.9 Evaluation and Quality Lab

AI variability requires product-level evaluation, especially when the customer has no development team.

Features:

- Golden scenario library.
- Real anonymized case promotion into tests.
- Expected structured outputs and prohibited behaviors.
- Deterministic policy assertions.
- Tool-call and approval assertions.
- Retrieval relevance/citation assertions.
- Model/profile comparison.
- Regression runs before publication.
- Human review scorecards.
- False automation and escalation analysis.
- Production feedback linked to scenarios.
- Release gate thresholds.

Evaluation levels:

1. Schema and deterministic policy checks.
2. Curated scenario regression.
3. Human review sampling.
4. Shadow-production comparison.
5. Post-deployment monitoring.

### 5.10 Privacy, Security, and Governance Center

Features:

- AI system and model inventory.
- Process risk classification.
- Data-flow map.
- Data classification catalog.
- Provider/model allowlist.
- Retention and deletion policies.
- Memory policy and provenance.
- Prompt-injection and untrusted-content boundaries.
- Tool permission review.
- Human oversight assignments.
- Administrative audit log.
- Consequential action audit.
- Incident register and after-action review.
- User feedback/complaint handling.
- Periodic review schedule.
- Policy attestations.
- Evidence export.
- Privacy request export/deletion workflow.

### Memory governance

Because durable memory can preserve attacker-controlled or incorrect context:

- every durable fact records source, creator, timestamp, confidence, sensitivity, and expiry;
- untrusted extracted content is not promoted to durable memory automatically;
- memory promotion uses allowlisted schemas and policy;
- users/operators can inspect, correct, quarantine, or delete memory;
- sensitive memory has explicit access scope;
- summaries remain traceable to source-message ranges; and
- memory changes appear in the audit timeline.

### 5.11 Value and Adoption Dashboard

The dashboard must measure business outcomes, not only tokens and runs.

Features:

- Items processed.
- Human minutes saved.
- Cycle-time change.
- Backlog reduction.
- Error/rework change.
- Approval and override rate.
- Escalation rate.
- Automation/containment rate.
- SLA achievement.
- Customer or employee satisfaction input.
- Estimated benefit.
- Cloudflare/model/integration operating cost.
- Net value and payback estimate.
- Usage and adoption by department/process.
- Training completion and help requests.

Metrics are compared to the discovery baseline and display calculation assumptions.

### 5.12 Learning and Help Center

No-dev customers require in-product operating guidance.

Features:

- Role-specific onboarding.
- Guided tours for owners, operators, approvers, and administrators.
- Plain-language explanation of Agents, Workflows, models, and approvals.
- Process-specific operating procedures.
- “Why did this happen?” trace explainer.
- Embedded release and incident checklists.
- Training acknowledgements.
- Customer runbook.
- FDE handoff checklist.
- Contextual help on risk and privacy settings.

## 6. Progressive autonomy

Every process uses an explicit autonomy level. Customers should be able to earn trust rather than choose between “manual” and “fully autonomous.”

| Level | Name | Behavior |
| --- | --- | --- |
| 0 | Observe | Capture process inputs and recommend nothing |
| 1 | Suggest | Produce drafts/recommendations; human performs action |
| 2 | Approve | AI prepares action; human approves execution |
| 3 | Guarded | AI executes allowlisted low-risk actions; exceptions require approval |
| 4 | Autonomous | AI executes within explicit policy and monitoring limits |

Features:

- Autonomy level per process and optionally per action/tool.
- Minimum evaluation evidence before promotion.
- Required process-owner approval for promotion.
- Automatic fallback to a safer level on health/risk thresholds.
- Implemented in Workrr One as a latched process safety cap: unsafe authorized reviews cap at Suggest immediately, bounded recent reliability can cap at Approve, and owner evidence is required to clear the cap.
- Visible autonomy badge on every run.
- Promotion history and rationale.
- Shadow mode that compares proposed actions without executing them.

This autonomy ladder should be an MVP centerpiece.

## 7. Process templates

Templates accelerate adoption but must remain adaptable.

Aggressive MVP template set:

1. Customer request triage and draft response.
2. Document intake and structured extraction.
3. Lead qualification and follow-up recommendation.
4. Internal knowledge assistant with escalation.
5. Approval-based external action.
6. Scheduled reconciliation/report preparation.

Each template includes:

- discovery questionnaire;
- current/future process map;
- Agent execution profiles;
- prompt and policy modules;
- typed mock tools;
- Workflow and Queue topology;
- approval defaults;
- test scenarios;
- success metrics;
- privacy/retention defaults;
- sample data; and
- customer-adapter instructions.

Templates are starting points, not opaque packaged bots.

## 8. Identity and access

Default roles:

- Platform Administrator.
- AI Builder / FDE.
- Process Owner.
- Operator.
- Approver.
- Auditor / Viewer.
- Employee / Consumer.

Capabilities are assigned independently of role names. Required controls:

- least privilege;
- separation between building and publishing for high-risk processes;
- delegated approvals;
- service identities for integrations;
- session/device audit;
- Cloudflare Access or OIDC option;
- native secure sessions for standalone deployments;
- read-only Agent connections for viewers; and
- emergency administrator access procedure.

## 9. Notifications and channels

MVP channels:

- in-application inbox;
- email;
- signed webhook/API;
- embeddable web chat/process form.

Later:

- Microsoft Teams;
- Slack;
- SMS/voice;
- customer portals;
- mobile push.

Notification policy supports severity, owner, escalation timing, quiet hours, digesting, and acknowledgement.

## 10. Managed deployment and lifecycle

The product must remain operable after the FDE leaves.

Features:

- Guided environment provisioning.
- Environment preflight.
- Development/test/production configuration separation.
- Additive migration management.
- Backup/export and restore procedure.
- Release channel and version visibility.
- Compatibility checks before upgrade.
- Customer configuration export.
- Upgrade notes and rollback plan.
- Health dashboard.
- Secret/configuration readiness checks.
- Managed maintenance window.
- Redacted support bundle.
- Ownership and escalation contacts.
- Disaster-recovery runbook.
- Process retirement and data disposal workflow.

Customer-owned Cloudflare accounts are the preferred private deployment. A managed dedicated deployment may be offered when the customer cannot operate an account, but must preserve clear data ownership and exit/export terms.

## 11. Aggressive MVP scope

The aggressive MVP should be broad in operational completeness, not broad in arbitrary programmability.

### P0 — Must work end to end

- AI Process catalog and owner.
- Process discovery record and manual baseline.
- Generated process topology.
- Conversation, instant, and Workflow execution profiles.
- Agent-local queue/schedule plus platform Queue/Cron/Workflow integration.
- Prompt/model/process releases and rollback.
- Workers AI profiles.
- Typed tools and connections.
- Approval inbox.
- Webhook/API ingestion, idempotency, retries, and DLQ.
- Run timeline and unified API log.
- Operational pause/read-only/emergency-stop controls.
- Roles and permissions.
- Private deployment/data-flow summary.
- Golden scenario tests.
- Shadow, approve, and guarded autonomy modes.
- Business-value baseline and initial metrics.
- Customer Operations Starter template.
- Guided deployment and handoff checklist.

### P1 — Belongs in an ambitious first customer release

- Knowledge Center with R2/Vectorize.
- Document intake template.
- Email channel.
- Scheduled reconciliation template.
- Production feedback-to-test flow.
- Periodic review and incident register.
- Credential expiry and connection-health alerts.
- Executive value dashboard.
- Contextual help and operator runbooks.
- Evidence export.
- Configuration export/restore.

### P2 — Add after first real deployment evidence

- Editable workflow canvas.
- MCP connector catalog.
- AI Gateway/provider routing.
- Teams and Slack.
- OIDC/SCIM lifecycle automation.
- Cross-deployment fleet management.
- Evaluation canaries/A-B releases.
- Advanced DLP/classification.
- Additional specialized Agent SDK capabilities.

## 12. Deliberate exclusions

- Arbitrary customer code execution in MVP.
- Open plugin marketplace.
- Every Workers AI model exposed without validation.
- Automatic autonomy promotion.
- Hidden cross-customer learning.
- Unreviewed memory formation.
- Unbounded browser or network access.
- General ERP/CRM replacement.
- Building every connector before customer demand.

## 13. Success criteria

### Implementation

- FDE provisions a working environment in under one hour.
- First mock process runs in under two hours.
- First real read-only customer integration is connected in one day.
- A typical first process reaches shadow mode within one week after discovery and data access.
- At least 80% of core code survives adaptation to the next customer.

### Operations

- An operator diagnoses a failed run in under five minutes without Wrangler.
- A process owner can approve, pause, or roll back without developer help.
- Every external action is attributable to a process release, actor, policy, and source event.
- Every waiting or failed item has a visible owner and next action.

### Business

- Every deployed process has a baseline and target.
- Value dashboard reports cycle time, human effort, overrides, failures, and operating cost.
- Customers can identify whether a process should be expanded, corrected, or retired.
- The second deployed process is materially faster than the first.

## 14. Research basis and product implications

Research consistently points to several needs:

- SME adoption is constrained by skills, data readiness, integration complexity, and finance—not merely access to a model.
- Businesses frequently use AI in isolated tools but fail to integrate it into operating systems.
- Organizations are uncomfortable with business data training external models.
- Governance requires system inventory, data provenance, human oversight, testing records, monitoring, and incident processes.
- Post-deployment monitoring must cover functionality, operations, human factors, security, compliance, and broader effects.
- Durable agent memory is an attack surface and needs provenance, correction, expiry, and promotion policy.

These findings justify the product emphasis on discovery, integrations, private deployment, progressive autonomy, approvals, evaluation, operational monitoring, memory governance, training, and measurable value.

## 15. Product hierarchy

The final hierarchy presented to customers should be:

```text
Organization
└── Process Portfolio
    └── AI Process
        ├── Business owner and value metrics
        ├── Operating/autonomy mode
        ├── Triggers and channels
        ├── Durable and instant Agents
        ├── Tools and connections
        ├── Knowledge and memory policy
        ├── Queues, schedules, Cron, and Workflows
        ├── Human checkpoints
        ├── Release and evaluations
        └── Runs, exceptions, and audit
```

This keeps the application understandable to the customer while preserving the full technical framework for the FDE.
