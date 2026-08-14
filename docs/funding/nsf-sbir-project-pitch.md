# NSF SBIR Project Pitch draft

## Working title

Evidence-Governed Runtime for Reliable Private AI Workflows

## Proposed topic

Advanced Systems for Scalable Analytics - Software Technologies for Scalable Analytical Systems / Knowledge and Data Management Technologies.

## Technology innovation

*Portal limit: 3,500 characters.*

Workrr proposes a provider-neutral runtime that makes AI-driven business processes reproducible, policy-bound, and auditable across synchronous calls, asynchronous queues, stateful agents, and long-running workflows deployed in a customer's own cloud account. Existing agent frameworks and workflow engines primarily optimize orchestration. Observability tools record model calls after they occur. Governance products typically operate as external policy or reporting layers. None provides a unified execution model that cryptographically and semantically binds an immutable process release, model configuration, authorization policy, data-handling rules, human approvals, tool actions, retry state, and outcome evidence to one reconstructable execution.

The high-risk innovation is an evidence-governed execution architecture that enforces policy at every state transition while retaining only the minimum information needed to reproduce and evaluate behavior. A deployment-keyed evidence graph will link release identity, protected-input digests, decision points, approvals, tool effects, model and prompt versions, retry/recovery events, and evaluated outcomes without retaining prohibited source values. The runtime will support customer-controlled deployment and multiple model providers while maintaining equivalent evidence semantics.

This is not a dashboard, prompt manager, or conventional workflow builder. Its technical contribution is a formal, portable contract between AI process definition, runtime enforcement, and post-execution evidence. If successful, it will allow a mid-market organization to answer not only what an AI system produced, but which immutable process and policies governed it, whether every side effect was authorized, whether sensitive information persisted, how failure and recovery changed state, and whether a model or release change caused a measurable regression.

The central uncertainty is whether complete enough evidence for reproducibility and regression detection can be generated across heterogeneous execution modes without retaining sensitive content or imposing prohibitive latency, storage, and inference cost. Phase I will establish feasibility through a formal state/evidence model, adversarial fault and privacy testing, and controlled comparisons against conventional agent orchestration and model-observability baselines.

## Technical objectives and challenges

*Portal limit: 3,500 characters.*

Objective 1 - Formalize the execution and evidence model. Define invariants for tenant isolation, immutable release identity, authorization, approval, idempotency, retry/recovery, tool side effects, data retention, and evidence lineage across synchronous, queued, durable-agent, and long-running workflow profiles. Build a reference implementation and property-based test harness. The challenge is preserving one set of invariants across execution systems with different consistency, ordering, and failure behavior.

Objective 2 - Develop privacy-preserving evidence. Evaluate deployment-keyed digests, bounded metadata, typed redaction/blocking events, and minimal state proofs that support trace reconstruction without storing prohibited input. Measure forbidden-value persistence, trace completeness, false linkage, storage overhead, and the effect of key or policy rotation. The challenge is the tension between auditability and data minimization.

Objective 3 - Detect release and model regressions. Develop release-pinned evaluation methods that connect pre-deployment test evidence with production outcomes while preventing silent upgrades of in-flight or stateful work. Compare detection power and cost against prompt-version and model-call monitoring baselines under injected model, prompt, tool-policy, and workflow changes. The challenge is detecting behaviorally meaningful regressions with sparse, heterogeneous outcomes and bounded inference budgets.

Objective 4 - Validate resilience and portability. Run controlled fault injection across at least two operational workflow archetypes and two model/provider configurations. Test concurrency, duplicate delivery, timeout, partial tool failure, approval expiration, provider fallback, rollout, and rollback. Candidate success criteria are: zero cross-tenant or prohibited-value persistence in the adversarial suite; at least 99.9% reconstructable execution histories; no unauthorized side effects under injected retries and failures; materially higher regression detection than baseline at a bounded evaluation cost; and no more than 15% runtime latency overhead at the target workload.

Key risks include excessive evidence overhead, insufficient information after redaction, provider-dependent behavior, and weak correspondence between offline evaluation and operational outcomes. Alternative strategies include tiered evidence levels, selective cryptographic commitments, outcome-specific evaluators, and workflow-class-specific admission policies.

## Market opportunity

*Portal limit: 1,750 characters.*

Mid-market organizations are adopting AI for document intake, customer response, exception handling, internal research, and multi-system operations, but many lack an internal AI platform team. They face a gap between demonstrations and production: agent frameworks can execute tasks, while enterprise governance suites are expensive, externally hosted, or disconnected from runtime state. Buyers with sensitive data also require deployment in their own Cloudflare, AWS, Azure, or Google Cloud environment.

Workrr will initially sell to U.S. organizations with 100-2,000 employees running high-volume, multi-system workflows in financial operations, payments, customer operations, regulated communications, and document-heavy back offices. Economic buyers are operations, technology, risk, and finance leaders. The initial offer combines a paid production deployment with an annual Workrr One platform license and support; solution packs and implementation partners create expansion paths.

Alternatives include agent/orchestration frameworks, model-observability platforms, automation suites, cloud-vendor agent services, and internal custom systems. Workrr differentiates through customer-owned deployment, one evidence contract spanning runtime modes, release-pinned evaluation, human authorization, data-minimized audit evidence, provider portability, and operational recovery. The Phase I innovation creates defensible technical IP and validation evidence needed to convert founder-led delivery into a repeatable platform sale.

Before a full proposal, Workrr will obtain at least three design-partner letters and validate willingness to pay, target deployment constraints, and the cost of current manual controls and failed AI pilots.

## Company and team

*Portal limit: 1,750 characters.*

Workrr is an Arizona LLC founded in 2023 that builds production AI systems, automation, integrations, retrieval, and customer-controlled cloud deployments. Founder Shawn Bure previously scaled a national recovery operation, founded and sold the collections platform OpenCollect, and has delivered systems across payments, telephony, CRM, integrations, and cloud infrastructure. Workrr also develops Reclaira as an internal software lab.

The team has implemented a Workrr One research prototype on Cloudflare's AI and serverless stack. Capabilities include immutable process releases, stateful and long-running execution, human approvals, tenant isolation, data-loss-prevention boundaries, evaluation, model governance, cost controls, incident containment, audited recovery, and deployment verification. This provides a mature experimental base while leaving the Phase I research questions unresolved.

Shawn Bure is the proposed principal investigator, subject to confirmation that he meets NSF primary-employment and project-effort requirements. Workrr will add a distributed-systems or formal-methods adviser, an applied evaluation or machine-learning adviser, and an independent security-testing resource. It will recruit design partners providing workflow requirements and de-identified or synthetic validation cases. All NSF-funded work will be performed in the United States.

Team gaps to close before a full proposal are formal-methods review, independent experimental validation, and a research adviser with publications in dependable distributed systems, AI evaluation, or privacy engineering. These roles will be filled through documented consulting or subaward relationships without outsourcing Workrr's required share of Phase I R&D.

## Submission checklist

- [ ] Founder confirms no other Workrr/individual Project Pitch is under review and annual pitch limits are not exceeded.
- [ ] Confirm exact legal LLC name and address.
- [ ] Confirm U.S. ownership eligibility.
- [ ] Confirm PI primary employment and minimum project effort.
- [ ] Confirm all funded work will occur in the United States.
- [ ] Founder approves the proposed 15% latency-overhead threshold.
- [ ] Select final NSF topic/subtopic.
- [ ] Verify character counts in portal.
- [ ] Founder reviews every factual and quantitative claim.
- [ ] Enter draft in TIP portal.
- [ ] Save as draft.
- [ ] Founder authorizes final portal submission.
