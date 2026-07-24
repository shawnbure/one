export type GuideTopic = {
  title: string;
  plain: string;
  details: string[];
};

export type GuideSection = {
  id: string;
  title: string;
  summary: string;
  topics: GuideTopic[];
};

export const productGuide: GuideSection[] = [
  {
    id: "welcome",
    title: "What Workrr Is",
    summary: "The purpose of the platform, who it helps, and what a successful AI implementation looks like.",
    topics: [
      {
        title: "The Simple Explanation",
        plain: "Workrr helps a company turn repeatable office work into safe AI-assisted processes. It gives employees a place to run the work and gives leaders a place to control, measure, and improve it.",
        details: [
          "A process is a defined job, such as sorting an inbox, preparing a renewal review, or answering questions from approved company knowledge.",
          "The AI does not receive unlimited freedom. Each process has an owner, instructions, allowed tools, data rules, tests, and an autonomy level.",
          "The goal is not to replace every person. The goal is to remove repetitive steps, make decisions easier to review, and return time to the organization."
        ]
      },
      {
        title: "Who Uses It",
        plain: "Different people see different parts of Workrr because they have different responsibilities.",
        details: [
          "Consumers run approved processes. Reviewers approve or reject important proposed actions.",
          "Owners are accountable for business results. Builders design and test processes. Operators watch live work and recover failures.",
          "Administrators manage the customer environment, access, policies, and platform settings. Viewers can inspect evidence without changing anything."
        ]
      },
      {
        title: "What Success Means",
        plain: "A process is successful when it produces useful work repeatedly, stays inside its approved boundaries, and creates enough evidence for a human to understand what happened.",
        details: [
          "Business success includes time returned, faster turnaround, fewer manual mistakes, better consistency, and measurable financial value.",
          "Operational success includes reliable executions, clear ownership, safe retries, controlled costs, and quick recovery.",
          "Governance success means sensitive data is handled correctly and consequential actions remain attributable to a person or an approved policy."
        ]
      }
    ]
  },
  {
    id: "map",
    title: "Application Map",
    summary: "What every area in the left menu is for and when you should use it.",
    topics: [
      {
        title: "Work",
        plain: "The Work group is where most people begin their day.",
        details: [
          "Overview shows health, value, recent volume, and work needing attention.",
          "Launchpad is the employee-facing place to start an approved process or continue a private conversation.",
          "Work Inbox contains human decisions, assigned reviews, missing information, and other items waiting for a person."
        ]
      },
      {
        title: "Build",
        plain: "The Build group turns a business problem into a tested, publishable AI process.",
        details: [
          "Opportunities captures manual work before anyone builds. Processes is the design, testing, release, and lifecycle workspace.",
          "Knowledge manages approved documents and retrieval. Connections manages external systems and credentials.",
          "Evaluations tests quality, safety, regressions, and model choices before a release is trusted."
        ]
      },
      {
        title: "Operate",
        plain: "The Operate group explains what is happening after processes begin running.",
        details: [
          "Activity is the evidence timeline for executions, durable actors, workflows, queues, failures, and recovery.",
          "API Logs shows retained request metadata for webhooks and integrations without displaying unnecessary sensitive bodies.",
          "Notifications controls accountable alerts, delivery channels, digests, and ownership."
        ]
      },
      {
        title: "Govern",
        plain: "The Govern group protects the organization and keeps AI connected to business value.",
        details: [
          "Governance contains privacy, retention, incidents, memory, model policy, emergency controls, and deployment evidence.",
          "Value & Decisions compares expected and measured outcomes so leaders can expand, correct, observe, or retire work.",
          "Usage & Budgets explains model consumption, tokens, cost, limits, and reconciliation."
        ]
      },
      {
        title: "Administration",
        plain: "Administration configures the customer environment rather than an individual AI process.",
        details: [
          "Settings is the organized entrance to customer, identity, privacy, notification, and budget settings.",
          "Customer Setup records the customer profile, operating defaults, ownership, and deployment handoff.",
          "Team & Roles controls members, roles, access status, and service principals. Help Center is this handbook, training center, runbook library, and support queue."
        ]
      }
    ]
  },
  {
    id: "process",
    title: "The Process Lifecycle",
    summary: "How a manual business activity becomes a safe production process.",
    topics: [
      {
        title: "1. Discover the Opportunity",
        plain: "Start with the work problem, not with a model or a chatbot.",
        details: [
          "Describe who does the work, the trigger, current steps, inputs, outputs, systems, volume, time spent, error rate, and pain points.",
          "Record the business owner and the people affected. Estimate the baseline so improvement can be measured later.",
          "Good candidates are repeated, explainable, and valuable. Unclear policy, missing ownership, or highly unusual judgment are warning signs."
        ]
      },
      {
        title: "2. Design the Process",
        plain: "A blueprint is the controlled definition of the AI-enabled job.",
        details: [
          "Choose an execution profile, model profile, autonomy level, instructions, tools, knowledge, memory behavior, and output contract.",
          "Define what the process must never do, what needs human approval, what evidence must be saved, and what happens on failure.",
          "Keep the process paused while its responsibilities, data, tools, and owner are incomplete."
        ]
      },
      {
        title: "3. Test and Release",
        plain: "A release is an immutable version of the process that can be tested and traced.",
        details: [
          "Golden scenarios represent inputs the process must handle correctly. Evaluations score quality, policy compliance, tool behavior, and prohibited output.",
          "Publishing creates a clear production boundary. Later edits belong in a new release, so old executions can still be explained.",
          "Begin with observe or suggest autonomy. Increase authority only when evidence and ownership justify it."
        ]
      },
      {
        title: "4. Operate and Improve",
        plain: "Production is the beginning of measurement, not the end of the build.",
        details: [
          "Watch executions, review decisions, failure patterns, response time, model use, cost, and business outcomes.",
          "Correct instructions, tools, data, or models through a new tested release. Roll back when a newer release is unsafe or less effective.",
          "Expand a proven process, pause one that needs correction, or retire one that no longer creates enough value."
        ]
      }
    ]
  },
  {
    id: "execution",
    title: "Agents, Actors, Workflows, and Queues",
    summary: "The different ways Workrr performs work on Cloudflare and why the distinction matters.",
    topics: [
      {
        title: "Instant Agent",
        plain: "An instant agent handles one request and finishes. It does not keep a sticky conversation identity.",
        details: [
          "Use it for classification, extraction, transformation, scoring, routing, or other fast independent tasks.",
          "The Worker that serves it is ephemeral: Cloudflare may create and remove runtime instances as demand changes.",
          "Important results and evidence are saved explicitly. The process must never depend on a particular Worker staying alive."
        ]
      },
      {
        title: "Durable Actor",
        plain: "A durable actor is one named, stateful instance of an agent definition. Many separate actors can use the same definition.",
        details: [
          "A conversation actor can be keyed by a thread. A customer actor can be keyed by a customer ID. An entity actor can be keyed by a case, order, or account.",
          "The identity key decides which requests are sticky to the same state. Two consumers do not share an actor unless the process explicitly chooses a shared key.",
          "Durable Objects provide strongly consistent state and coordination. They are a durable memory and event boundary, not a server that must compute forever."
        ]
      },
      {
        title: "Workflow",
        plain: "A Workflow is a durable sequence of steps that may wait, retry, or continue later.",
        details: [
          "Use it for multi-stage work, scheduled follow-ups, approval waits, release rollouts, retention jobs, or any job that must survive separate Worker invocations.",
          "A workflow checkpoint remembers orchestration progress. It is different from a human-style conversation memory.",
          "Each step should be repeat-safe because a durable system may retry after a temporary failure."
        ]
      },
      {
        title: "Queue, Schedule, and Cron",
        plain: "Queues absorb bursts; schedules start future work; cron starts repeating maintenance.",
        details: [
          "A Queue accepts asynchronous jobs, retries delivery, and can move repeatedly failing messages to a dead-letter queue.",
          "A schedule belongs to a process or actor when timing is part of its behavior. Cron is best for platform-wide recurring maintenance.",
          "None of these is conversational memory. They carry work or timing information into the next controlled execution."
        ]
      }
    ]
  },
  {
    id: "memory",
    title: "Conversations, State, and Memory",
    summary: "What the system remembers, what it should forget, and how repeated requests stay correctly separated.",
    topics: [
      {
        title: "Thread Stickiness",
        plain: "A threaded conversation uses the same process and thread identity so later messages can continue the right conversation.",
        details: [
          "The thread ID selects the durable actor. Requests with another thread ID go to another actor, even when they use the same process definition.",
          "Consumer, entity, and shared-shard profiles use different identity keys for different business needs.",
          "An instant request has no sticky actor. Any context it needs must arrive with the request or be retrieved from an approved source."
        ]
      },
      {
        title: "Working State vs. Long-Term Memory",
        plain: "Working state helps finish current work. Long-term memory is a separately governed fact intended to be useful later.",
        details: [
          "Conversation messages, tool progress, and temporary decisions can live with the actor while the work is active.",
          "A long-term fact needs a source, purpose, classification, expiry, and policy. Sensitive facts should not become memory merely because someone mentioned them.",
          "Deleting or expiring memory should not destroy required audit evidence; operational evidence and reusable memory have different purposes."
        ]
      },
      {
        title: "Prompt and Context Reuse",
        plain: "Workrr builds a bounded context for each model call instead of repeatedly reading everything the company owns.",
        details: [
          "Stable release instructions can be reused from the process release. Recent thread turns and small actor state are read from the actor when needed.",
          "Knowledge retrieval adds only relevant document passages. Tool results add only the information required for the next step.",
          "Context budgets prevent a growing conversation from becoming slow and expensive. Older material can be summarized, cited, expired, or omitted."
        ]
      }
    ]
  },
  {
    id: "fields",
    title: "Process Fields Explained",
    summary: "The important fields you see while designing, releasing, and operating a process.",
    topics: [
      {
        title: "Identity and Ownership Fields",
        plain: "These fields tell people what the process is and who is responsible for it.",
        details: [
          "Name: a clear business name. Description: one sentence explaining the job. Department: the organization that uses it.",
          "Business Owner: the person accountable for outcome and acceptable risk. Technical Owner: the person responsible for implementation and recovery.",
          "Purpose: why the process should exist. Status: draft, testing, active, paused, or retired. Tags: labels used for finding and grouping work."
        ]
      },
      {
        title: "Behavior Fields",
        plain: "These fields decide how the AI approaches the job.",
        details: [
          "Instructions or System Prompt: the role, method, boundaries, and response behavior. Input Contract: required data and accepted format.",
          "Output Contract: the shape and meaning of a valid result. Model Profile: a governed choice such as fast, balanced, or reasoning.",
          "Temperature or creativity controls variation when exposed. Lower variation is usually better for repeatable business work."
        ]
      },
      {
        title: "Execution Fields",
        plain: "These fields decide how an individual run is identified and coordinated.",
        details: [
          "Execution Profile: instant, conversation, consumer, entity, shared shard, temporary durable, or workflow.",
          "Thread ID: sticky conversation identity. Consumer ID: sticky employee or user identity. Entity ID: sticky business object identity. Shard Key: an intentionally shared coordination group.",
          "Execution ID: the unique run identifier used in Activity, support, and audit evidence. Idempotency Key: prevents one intended action from being performed twice."
        ]
      },
      {
        title: "Control Fields",
        plain: "These fields define how much authority the process receives.",
        details: [
          "Autonomy: observe records, suggest recommends, approve waits for a person, and auto performs only approved bounded actions.",
          "Risk Level: the potential business, privacy, security, or customer harm. Approval Policy: which actions need which reviewers.",
          "Allowed Tools: exact actions the process may call. Data Classes: types of information it may receive. Retention: how long state and evidence remain."
        ]
      },
      {
        title: "Release and Evaluation Fields",
        plain: "These fields connect a production result to the exact version and proof that allowed it to run.",
        details: [
          "Release ID and Version identify immutable behavior. Prompt Release identifies the exact instructions. Model Pin records the model choice.",
          "Evaluation Suite contains test scenarios. Threshold is the minimum acceptable score. Prohibited Output rules are hard safety failures.",
          "Published By and Published At establish accountability. Rollback Target identifies the last safe release."
        ]
      },
      {
        title: "Business Measurement Fields",
        plain: "These fields show whether the process is worth operating.",
        details: [
          "Baseline Volume, Minutes per Item, Error Rate, and Cost describe the old manual process.",
          "Target Outcome and Value Hypothesis describe the expected improvement. Time Returned and Estimated Value show measured results.",
          "Quality, Completion, Failure, Review, and Escalation rates reveal whether speed was gained without lowering trust."
        ]
      }
    ]
  },
  {
    id: "tools",
    title: "Knowledge, Tools, and Connections",
    summary: "How agents safely read company information and interact with outside systems.",
    topics: [
      {
        title: "Knowledge",
        plain: "Knowledge is approved company content the process may search for relevant evidence.",
        details: [
          "Documents are stored separately from the model. Retrieval finds small relevant passages and attaches citations.",
          "A citation shows where an answer came from. Missing or weak evidence should lower confidence or trigger human review.",
          "Access, classification, freshness, and deletion matter. A process should not retrieve every document merely because it exists."
        ]
      },
      {
        title: "Tools",
        plain: "A tool is a specific action the process can request, such as looking up a customer or drafting a ticket.",
        details: [
          "A typed input contract limits what the AI can send. Validation rejects malformed or out-of-policy requests before the external action.",
          "Read tools are usually lower risk than write tools. Consequential writes should be bounded, idempotent, and approval-aware.",
          "Tool evidence records what was requested, what policy allowed it, and what result was returned without retaining unnecessary secrets."
        ]
      },
      {
        title: "Connections and MCP",
        plain: "A connection supplies controlled access to another system. MCP is one standard for exposing tools and resources to an agent.",
        details: [
          "Credentials belong in secret storage and should never be placed in prompts, logs, exports, or help requests.",
          "OAuth connections have scopes and expiry. Service principals represent machine access and need an owner and lifecycle.",
          "Connection health, acceptance tests, and expiration alerts catch failures before a business process depends on a broken integration."
        ]
      }
    ]
  },
  {
    id: "controls",
    title: "Safety, Privacy, and Human Control",
    summary: "How Workrr limits authority, protects information, and makes important actions reviewable.",
    topics: [
      {
        title: "Human Approval",
        plain: "Approval means the AI proposes one exact action and a permitted person decides whether that action may proceed.",
        details: [
          "The reviewer should see the source, reasoning evidence, affected system, proposed change, and policy—not only a friendly summary.",
          "Approve, reject, request information, and escalate are different accountable outcomes.",
          "The proposal record and the later action result remain separate so an approval cannot falsely imply successful execution."
        ]
      },
      {
        title: "Data Protection",
        plain: "Use the minimum information needed for the approved purpose.",
        details: [
          "Data classification describes sensitivity. DLP rules detect or block prohibited content. Egress controls limit where information may go.",
          "Retention removes information after its useful or required period. Privacy reports provide evidence without exposing the underlying private data.",
          "Tenant isolation keeps one customer environment from reading another customer's configuration, state, or evidence."
        ]
      },
      {
        title: "Containment and Recovery",
        plain: "When behavior is uncertain, stop expansion first and investigate second.",
        details: [
          "Pause stops a process from taking new work. Drain allows accepted work to finish while new work is blocked. Emergency stop is the strongest tenant-level containment.",
          "Retries are safe only when the action is repeat-safe or protected by idempotency. Dead-letter work needs an owner and a repair decision.",
          "Incidents record severity, owner, containment, investigation, correction, verification, and closure evidence."
        ]
      }
    ]
  },
  {
    id: "models",
    title: "Models, Usage, and Cost",
    summary: "How model choices work and how the organization keeps quality and spending understandable.",
    topics: [
      {
        title: "Model Profiles",
        plain: "A model profile expresses the job's needs without forcing every builder to memorize provider model names.",
        details: [
          "Fast fits simple classification and extraction. Balanced fits common reasoning and drafting. Reasoning fits harder multi-step analysis.",
          "Cloudflare-hosted models are the primary private path. Gateway handoff models can be added later under separate policy.",
          "A release can pin a tested model choice so a provider change does not silently change production behavior."
        ]
      },
      {
        title: "What Creates Cost",
        plain: "Model work is usually measured by input tokens, output tokens, model choice, and number of calls.",
        details: [
          "Long prompts, large conversation histories, broad document retrieval, repeated retries, and unnecessary model calls increase cost and delay.",
          "Durable state and D1 have their own storage or read costs. Good design reads only the bounded state needed for the current decision.",
          "Budgets can be set by tenant, process, model, or time period. Alerts should arrive before a hard limit disrupts important work."
        ]
      },
      {
        title: "Quality Before Price",
        plain: "The cheapest model is not inexpensive if people must redo its work, and the strongest model is wasteful if a smaller model performs the job safely.",
        details: [
          "Compare models with the same evaluation scenarios and business acceptance criteria.",
          "Measure task success, policy failures, review burden, response time, and total cost together.",
          "Use routing only when the rule is understandable and tested—for example, fast classification followed by deeper reasoning only for complex cases."
        ]
      }
    ]
  },
  {
    id: "evidence",
    title: "Activity, Logs, and Evidence",
    summary: "How to understand what happened without reading raw infrastructure output.",
    topics: [
      {
        title: "Execution Timeline",
        plain: "Activity tells the story of a run from acceptance to completion, waiting, failure, or cancellation.",
        details: [
          "Look for the process and release, actor identity, input acceptance, model calls, tool proposals, approvals, workflow steps, retries, and final outcome.",
          "A status says where the work is now. Evidence explains why it reached that status.",
          "Use the execution ID when asking for help so the operator can inspect the exact run."
        ]
      },
      {
        title: "API and Audit Logs",
        plain: "API Logs help diagnose integrations; audit records establish who changed or decided what.",
        details: [
          "Request metadata includes route, method, status, timing, tenant, and correlation identifiers. Sensitive request bodies should not be retained by default.",
          "Audit events cover configuration changes, releases, approvals, access changes, incident transitions, and other accountable actions.",
          "Logs are not long-term memory and should not become an uncontrolled copy of customer data."
        ]
      },
      {
        title: "Common Statuses",
        plain: "Statuses are short labels for the current operational state.",
        details: [
          "Queued means accepted for later delivery. Active means currently progressing. Waiting Approval means a person must decide.",
          "Completed means the governed work finished. Failed means it did not finish. Deferred means it intentionally waits for another condition.",
          "Blocked means policy or dependency prevents progress. Retrying means the system is attempting a bounded recovery. Cancelled means an authorized stop ended the run."
        ]
      }
    ]
  },
  {
    id: "examples",
    title: "Examples and First-Day Playbooks",
    summary: "Concrete ways a customer can begin using the platform.",
    topics: [
      {
        title: "Inbox Triage",
        plain: "An instant process reads a new request, identifies its topic and urgency, and recommends the right owner.",
        details: [
          "Business benefit: less sorting time and faster response. Inputs: approved message fields. Output: category, urgency, owner, and evidence.",
          "Start in suggest mode. Require approval before moving or assigning sensitive requests.",
          "Measure routing accuracy, minutes returned, reassignment rate, and response time."
        ]
      },
      {
        title: "Customer Conversation",
        plain: "A durable conversation actor helps an employee manage one customer thread over time.",
        details: [
          "The thread ID keeps each customer conversation separate. Approved knowledge supplies policy and product facts.",
          "The actor may remember bounded working state, but long-term customer facts follow explicit memory and retention policy.",
          "Require approval for commitments, refunds, contract changes, or messages sent outside the company."
        ]
      },
      {
        title: "Renewal Review",
        plain: "A workflow gathers contract and usage facts, scores risk, drafts a brief, waits for review, and schedules follow-up.",
        details: [
          "Business benefit: consistent preparation and fewer missed renewals. The workflow survives waits and temporary system failures.",
          "Queue-based fan-out can gather independent facts. A reviewer owns the final recommendation and customer-facing action.",
          "Measure preparation time, evidence completeness, forecast accuracy, and renewal outcomes."
        ]
      },
      {
        title: "Your First Safe Rollout",
        plain: "Choose one repeated process with a clear owner and a small, measurable outcome.",
        details: [
          "Document the current method and baseline. Build the smallest useful version with read-only tools and suggest autonomy.",
          "Test real examples with private data removed or carefully controlled. Run a limited pilot with named users.",
          "Review results weekly, correct through releases, and expand only after value and safety evidence agree."
        ]
      }
    ]
  },
  {
    id: "glossary",
    title: "Plain-Language Glossary",
    summary: "Short definitions for words used throughout Workrr.",
    topics: [
      {
        title: "Core Product Terms",
        plain: "These words describe the business application.",
        details: [
          "Opportunity: a candidate manual process. Blueprint: the editable process definition. Release: one locked version of that definition.",
          "Execution: one run. Process: the reusable governed job. Agent: AI behavior that reasons or chooses a next step.",
          "Owner: accountable business person. Consumer: employee using a process. Reviewer: person deciding a proposed action."
        ]
      },
      {
        title: "Cloudflare Terms",
        plain: "These words describe the platform underneath Workrr.",
        details: [
          "Worker: short-lived code that handles requests. Durable Object: strongly consistent state and coordination for one identity.",
          "D1: relational database for configuration and evidence. R2: object storage for documents and larger files. Vectorize: similarity search for relevant knowledge.",
          "Workers AI: Cloudflare-hosted model inference. AI Gateway: governed route to model providers. Queue: asynchronous delivery. Workflow: durable multi-step orchestration."
        ]
      },
      {
        title: "Safety and Quality Terms",
        plain: "These words explain how trust is created.",
        details: [
          "Evaluation: a repeatable test. Golden Scenario: an example with an expected result. Guardrail: a rule that limits behavior.",
          "Autonomy: how independently a process may act. DLP: detection or blocking of sensitive data. Retention: how long information remains.",
          "Idempotency: protection against doing the same intended action twice. Audit Evidence: retained proof of an accountable event."
        ]
      }
    ]
  }
];
