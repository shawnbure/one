from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, HRFlowable
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#18332A")
GREEN = colors.HexColor("#2F7B5E")
MINT = colors.HexColor("#E7F3ED")
PALE = colors.HexColor("#F5F8F6")
LINE = colors.HexColor("#D9E4DE")
MUTED = colors.HexColor("#5D7067")
AMBER = colors.HexColor("#A56A20")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=28, leading=33, textColor=INK, alignment=TA_LEFT, spaceAfter=16
))
styles.add(ParagraphStyle(
    name="CoverDeck", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=13, leading=19, textColor=MUTED, spaceAfter=18
))
styles.add(ParagraphStyle(
    name="H1Workrr", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=20, leading=25, textColor=INK, spaceBefore=4, spaceAfter=12
))
styles.add(ParagraphStyle(
    name="H2Workrr", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=14, leading=18, textColor=GREEN, spaceBefore=12, spaceAfter=7
))
styles.add(ParagraphStyle(
    name="H3Workrr", parent=styles["Heading3"], fontName="Helvetica-Bold",
    fontSize=11, leading=14, textColor=INK, spaceBefore=8, spaceAfter=4
))
styles.add(ParagraphStyle(
    name="BodyWorkrr", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.4, leading=14, textColor=colors.HexColor("#344A40"), spaceAfter=7
))
styles.add(ParagraphStyle(
    name="SmallWorkrr", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.8, leading=11, textColor=MUTED
))
styles.add(ParagraphStyle(
    name="BulletWorkrr", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.2, leading=13.5, leftIndent=13, firstLineIndent=-8,
    bulletIndent=0, textColor=colors.HexColor("#344A40"), spaceAfter=4
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=17, textColor=INK, alignment=TA_LEFT
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=8, leading=10, textColor=WHITE
))
styles.add(ParagraphStyle(
    name="TableBody", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.8, leading=10.5, textColor=colors.HexColor("#344A40")
))
styles.add(ParagraphStyle(
    name="Check", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.7, leading=12.5, textColor=colors.HexColor("#344A40")
))


def p(text, style="BodyWorkrr"):
    return Paragraph(text, styles[style])


def bullets(items):
    return [Paragraph(f"- {item}", styles["BulletWorkrr"]) for item in items]


def section(title, paragraphs=None, bullet_items=None):
    flow = [p(title, "H2Workrr")]
    for text in paragraphs or []:
        flow.append(p(text))
    flow.extend(bullets(bullet_items or []))
    return flow


def callout(title, body):
    table = Table([
        [p(title, "Callout")],
        [p(body, "BodyWorkrr")]
    ], colWidths=[6.75 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), MINT),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, 0), 12),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 12),
    ]))
    return table


def data_table(headers, rows, widths):
    body = [[p(h, "TableHead") for h in headers]]
    body.extend([[p(str(cell), "TableBody") for cell in row] for row in rows])
    table = Table(body, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE]),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def on_page(canvas, doc):
    canvas.saveState()
    width, height = LETTER
    canvas.setFillColor(INK)
    canvas.rect(0, height - 0.16 * inch, width, 0.16 * inch, fill=1, stroke=0)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(GREEN)
    canvas.drawString(0.65 * inch, 0.42 * inch, "workrr")
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 0.65 * inch, 0.42 * inch, f"Private AI Operations  |  {doc.page}")
    canvas.restoreState()


def build_pdf(filename, title, subtitle, audience, story):
    path = OUT / filename
    doc = BaseDocTemplate(
        str(path), pagesize=LETTER, rightMargin=0.65 * inch, leftMargin=0.65 * inch,
        topMargin=0.62 * inch, bottomMargin=0.68 * inch, title=title,
        author="Workrr", subject=subtitle
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="workrr", frames=[frame], onPage=on_page)])
    cover = [
        Spacer(1, 0.55 * inch),
        p("WORKRR  |  PRIVATE AI OPERATIONS", "SmallWorkrr"),
        Spacer(1, 0.15 * inch),
        p(title, "CoverTitle"),
        p(subtitle, "CoverDeck"),
        HRFlowable(width="100%", thickness=1, color=LINE, spaceBefore=6, spaceAfter=18),
        callout("Built for practical private AI",
                "A Cloudflare-native framework and operating application for turning repeatable manual work into governed, measurable AI processes."),
        Spacer(1, 0.25 * inch),
        p(f"<b>Intended audience:</b> {audience}", "BodyWorkrr"),
        p("<b>Prepared:</b> July 2026", "BodyWorkrr"),
        p("<b>Status:</b> Working product document - customer language should be validated during discovery.", "SmallWorkrr"),
        PageBreak()
    ]
    doc.build(cover + story)
    return path


def elevator_pitch():
    story = []
    story += section("The 15-Second Pitch", [
        "Workrr helps mid-market companies turn repetitive office work into private, governed AI processes without hiring a full AI development team."
    ])
    story += section("The 30-Second Pitch", [
        "Workrr is a Cloudflare-native private AI operating platform for organizations that want useful automation but do not have a large development staff. It gives employees a simple launchpad for approved AI processes and gives leaders the controls they need for ownership, human approval, privacy, audit evidence, cost, and business value. Forward-deployed engineers use the framework to move from a manual workflow to a reliable customer-specific solution quickly."
    ])
    story.append(callout(
        "The core idea",
        "Do not sell a chatbot. Deliver a governed business capability with an owner, a measurable outcome, controlled tools, versioned behavior, and evidence."
    ))
    story += section("The Problem", bullet_items=[
        "Employees are experimenting with public AI tools outside approved processes.",
        "Manual work remains slow, inconsistent, difficult to measure, and dependent on a few experienced people.",
        "AI proofs of concept do not become dependable production operations.",
        "Small and mid-market organizations lack the engineering staff to build identity, orchestration, memory, approvals, observability, and governance from scratch.",
        "Leaders cannot explain what the AI did, what it cost, who approved it, or whether it created value."
    ])
    story += section("The Workrr Answer", bullet_items=[
        "A private customer environment deployed on Cloudflare.",
        "A reusable agent and process framework for instant work, durable conversations, entities, queues, schedules, and workflows.",
        "A polished application for employees, reviewers, owners, operators, administrators, and forward-deployed engineers.",
        "Human checkpoints for consequential actions and durable evidence for releases, executions, approvals, tools, incidents, and value.",
        "A delivery path that starts with discovery and grows into customer-specific automation."
    ])
    story += section("Why Cloudflare", [
        "Cloudflare supplies a globally distributed application runtime, private model inference, durable actors, workflows, queues, relational and object storage, vector search, identity controls, and security services in one operational platform. Workrr uses ephemeral Workers for request compute and explicit durable boundaries for state and orchestration."
    ])
    story += section("Ideal Customer", bullet_items=[
        "Roughly 100 to 2,000 employees with repeated knowledge-work processes.",
        "No dedicated AI platform team or limited internal development capacity.",
        "A need for customer or company data to remain controlled.",
        "A business leader willing to own one measurable workflow.",
        "Pressure to improve service, throughput, or operating margin without adding equivalent headcount."
    ])
    story += section("Business Outcomes", bullet_items=[
        "Return employee time by removing repeated sorting, lookup, drafting, routing, and preparation steps.",
        "Reduce errors and variation by encoding the accepted procedure.",
        "Shorten turnaround time while keeping important decisions attributable to people.",
        "Create an auditable path from opportunity to release, execution, value, and retirement.",
        "Build a reusable AI operating capability rather than isolated experiments."
    ])
    story += section("Example Use Cases", bullet_items=[
        "Inbox triage and request routing.",
        "Customer conversation support with approved knowledge and human approval.",
        "Renewal review preparation and risk scoring.",
        "Document intake, extraction, validation, and case creation.",
        "Policy Q&A with citations and controlled escalation.",
        "Recurring operational reviews and exception follow-up."
    ])
    story += section("Common Objections", [])
    story.append(data_table(
        ["Objection", "Response"],
        [
            ["We can use a general chatbot.", "A chatbot can draft text. Workrr defines the complete business process: identity, tools, data, approvals, releases, evidence, operations, and value."],
            ["We do not have developers.", "The framework is designed for forward-deployed delivery and customer administrators, with reusable patterns and an operating interface."],
            ["AI is too risky.", "Risk is bounded by process-specific tools, autonomy, approvals, data policy, evaluation, containment, and audit evidence."],
            ["We are not ready for a big program.", "Start with one repeated process, one owner, a small pilot group, and a measurable baseline."],
            ["How do we know it pays off?", "The process carries a baseline, target, production measures, estimated value, and an explicit expand, correct, observe, or retire decision."]
        ],
        [1.85 * inch, 4.9 * inch]
    ))
    story += section("Close", [
        "The next step is a 60-minute discovery session. We identify one high-friction process, document its current steps and baseline, define the acceptable AI boundary, and decide whether a focused pilot is valuable."
    ])
    return build_pdf(
        "workrr-elevator-pitch.pdf",
        "Workrr Elevator Pitch",
        "A concise narrative for explaining the product, its customer, and its business value.",
        "Prospective customers, partners, investors, and implementation stakeholders",
        story
    )


def marketing_plan():
    story = []
    story += section("Executive Summary", [
        "Workrr should be positioned as the private AI process platform for mid-market organizations that need implementation help, not another do-it-yourself chatbot. The commercial wedge is one measurable manual process. The expansion motion is a governed catalog of department processes operated on one customer platform."
    ])
    story += section("Market Position", [])
    story.append(data_table(
        ["Element", "Position"],
        [
            ["Category", "Private AI operations and process enablement"],
            ["Primary buyer", "COO, CIO, operations leader, customer service leader, or transformation sponsor"],
            ["Primary user", "Employees, reviewers, process owners, operators, and forward-deployed engineers"],
            ["Customer profile", "Mid-market SMB with meaningful process volume and limited AI development staff"],
            ["Core promise", "Move from manual work to a governed production AI process without building the platform foundation from scratch"],
            ["Differentiator", "Cloudflare-native application, agent framework, delivery playbook, human controls, and value evidence in one system"]
        ],
        [1.45 * inch, 5.3 * inch]
    ))
    story += section("Ideal Customer Profile", bullet_items=[
        "100 to 2,000 employees, often operating across several locations or service teams.",
        "Repeated email, document, customer, case, finance, HR, or operations workflows.",
        "Executive pressure to improve throughput or service without matching headcount growth.",
        "Limited internal engineering capacity and concern about unmanaged public AI use.",
        "Available process owner, representative examples, and willingness to run a bounded pilot.",
        "Best initial vertical hypotheses: professional services, insurance and benefits, logistics, specialty healthcare administration, field services, B2B customer operations, and multi-location service businesses."
    ])
    story += section("Personas and Buying Motives", [])
    story.append(data_table(
        ["Persona", "What They Care About", "Message"],
        [
            ["Operations executive", "Time, throughput, consistency, customer experience", "AI-ify a real process and measure the returned capacity."],
            ["CIO / IT leader", "Security, architecture, support burden, integration", "One Cloudflare-native control plane instead of disconnected experiments."],
            ["Risk / privacy leader", "Data handling, accountability, evidence, retention", "Process-specific authority, human control, tenant isolation, and audit evidence."],
            ["Department owner", "Backlog, quality, adoption, exceptions", "A solution designed around your actual work and owned by your team."],
            ["Finance sponsor", "Cost, payback, scalability", "Baseline the manual work, meter AI usage, and expand only where results justify it."]
        ],
        [1.2 * inch, 2.55 * inch, 3.0 * inch]
    ))
    story += section("Messaging Architecture", bullet_items=[
        "Headline: Private AI that performs real business work.",
        "Value statement: Turn repeated manual processes into governed AI capabilities with a forward-deployed implementation path.",
        "Proof pillars: private Cloudflare architecture; process-specific agents and workflows; human approvals and evidence; measurable value; reusable customer deployment.",
        "Avoid: leading with model names, claiming full autonomy, presenting a generic chat demo, or promising savings before discovery.",
        "Tone: practical, credible, plain-language, operational, and respectful of customer risk."
    ])
    story += section("Offer Ladder", [])
    story.append(data_table(
        ["Offer", "Purpose", "Indicative Output"],
        [
            ["AI Process Discovery", "Qualify one or more workflows", "Process map, baseline, risk boundary, prioritized opportunity brief"],
            ["Private AI Pilot", "Prove one process with real users", "Configured environment, tested release, training, pilot report"],
            ["Production Foundation", "Establish dependable operation", "Identity, controls, runbooks, support model, value review"],
            ["Department Expansion", "Add related processes and integrations", "Reusable solution patterns and shared governed services"],
            ["Managed Improvement", "Operate and improve over time", "Monthly value, quality, cost, release, and risk reviews"]
        ],
        [1.35 * inch, 2.2 * inch, 3.2 * inch]
    ))
    story += section("Demand Generation", bullet_items=[
        "Founder-led content: short process teardowns, Cloudflare agent architecture explanations, and before/after operating stories.",
        "Open-source framework: publish safe reusable foundations and examples while retaining implementation, customer configuration, and managed operations as services.",
        "Workshops: 'Find your first private AI process' for operations and technology leaders.",
        "Assessment: a scored manual-process intake that produces a practical opportunity brief.",
        "Partner motion: Cloudflare consultants, managed service providers, fractional CIOs, and vertical operations advisors.",
        "Case-study motion: quantify baseline, pilot result, safeguards, user adoption, and next expansion decision."
    ])
    story += section("Content Program", [])
    story.append(data_table(
        ["Theme", "Example Content", "Call to Action"],
        [
            ["AI process design", "Why a process is more valuable than a chatbot", "Download discovery checklist"],
            ["Private architecture", "Ephemeral Workers and durable actors explained", "Architecture review"],
            ["Human control", "What a good AI approval screen must show", "Governance workshop"],
            ["SMB implementation", "How to pilot without an AI team", "Book discovery"],
            ["Value evidence", "Measure time returned without fake ROI", "Baseline calculator"],
            ["Build in public", "Workrr feature demos and release notes", "Try the framework / join updates"]
        ],
        [1.4 * inch, 3.6 * inch, 1.75 * inch]
    ))
    story += section("90-Day Launch Plan", [])
    story.append(data_table(
        ["Period", "Objectives", "Key Actions"],
        [
            ["Days 1-30", "Clarify story and create sales foundation", "Finalize positioning; publish product page; package pitch, checklist, architecture review, and one demo process; identify 50 target accounts."],
            ["Days 31-60", "Generate conversations and learn", "Run two workshops; publish weekly founder content; conduct 10 discovery calls; recruit 2 design partners; refine objections and vertical signals."],
            ["Days 61-90", "Convert proof into repeatable motion", "Launch one pilot; publish an anonymized process teardown; formalize partner brief; create case-study template; review funnel and narrow ICP."]
        ],
        [0.9 * inch, 2.25 * inch, 3.6 * inch]
    ))
    story += section("Funnel and Metrics", bullet_items=[
        "Awareness: qualified site visits, guide downloads, workshop registrations, partner introductions.",
        "Engagement: discovery calls, completed process assessments, identified owners, qualified use cases.",
        "Pipeline: paid discoveries, pilots proposed, pilots started, sales-cycle duration.",
        "Delivery: time to first tested process, pilot adoption, accepted output, exceptions, support burden.",
        "Commercial: pilot conversion, annualized contract value, gross margin, expansion processes, retention.",
        "Do not optimize for raw leads. Optimize for conversations with a real process, owner, data, and measurable pain."
    ])
    story += section("Risks and Mitigations", bullet_items=[
        "Risk: category sounds broad. Mitigation: lead with specific process examples and one department outcome.",
        "Risk: open source attracts builders but not buyers. Mitigation: separate framework content from the implementation and operating offer.",
        "Risk: privacy claims become absolute. Mitigation: describe architecture and policy precisely; validate provider terms and customer requirements.",
        "Risk: pilots stall after demos. Mitigation: require owner, baseline, acceptance criteria, users, and expansion decision before build.",
        "Risk: custom services do not scale. Mitigation: convert repeated delivery work into solution packs, templates, tests, and product controls."
    ])
    return build_pdf(
        "workrr-marketing-plan.pdf",
        "Workrr Marketing Plan",
        "A practical go-to-market plan for creating demand, qualifying customers, and building a repeatable category position.",
        "Founder, marketing partners, sales leadership, and channel partners",
        story
    )


def software_review():
    story = []
    story += section("Review Scope and Conclusion", [
        "Workrr is an ambitious Cloudflare-native private AI operations framework and application. It combines customer deployment, process discovery, agent execution, durable actors, workflows, queues, knowledge, integrations, evaluations, approvals, observability, governance, cost, value, training, and support.",
        "The strongest product idea is that an AI implementation is a governed business process rather than a prompt or bot. The architecture is aligned with Cloudflare's execution model: ephemeral Workers handle compute; Durable Objects and the Agents SDK provide identity-scoped state; Workflows handle durable orchestration; Queues absorb asynchronous bursts; D1 stores relational configuration and evidence; R2 and Vectorize support knowledge; Workers AI provides primary inference."
    ])
    story.append(callout(
        "Overall assessment",
        "A strong product foundation with unusually broad operating depth for an MVP. The primary product risk is not missing capability; it is complexity, information architecture, and ensuring every advanced control has a clear customer-facing reason."
    ))
    story += section("Product Architecture", [])
    story.append(data_table(
        ["Layer", "Responsibility", "Assessment"],
        [
            ["Experience", "Admin application, Launchpad, Work Inbox, Help Center", "Broad role coverage; continue simplifying navigation and progressive disclosure."],
            ["Process control", "Blueprints, releases, autonomy, tools, contracts, schedules", "Strong foundation for repeatable customer implementations."],
            ["Agent runtime", "Instant agents and durable Agent SDK actors", "Correct distinction between stateless requests and identity-scoped durable state."],
            ["Orchestration", "Workflows, queues, cron, retries, disposal", "Well matched to work that waits or survives Worker invocations."],
            ["Data", "D1, R2, Vectorize, actor state", "Appropriate separation; bounded reads and retention need continuous cost review."],
            ["AI", "Workers AI model profiles and later gateway handoff", "Sensible Cloudflare-first policy with room for controlled provider expansion."],
            ["Operations", "Activity, API logs, notifications, incidents, recovery", "A material differentiator from prototype agent frameworks."],
            ["Governance", "Approvals, privacy, memory, retention, DLP, deployment evidence", "Deep MVP scope; requires careful UX and plain-language education."]
        ],
        [1.05 * inch, 2.75 * inch, 2.95 * inch]
    ))
    story += section("Execution Model", [
        "<b>Instant:</b> One request with no sticky agent identity. Appropriate for classification, extraction, scoring, routing, and burst processing.",
        "<b>Durable:</b> Many actor instances can use the same agent definition. A thread, consumer, entity, temporary identity, or shard key determines which requests return to the same strongly consistent state.",
        "<b>Workflow:</b> Durable checkpoints for multi-step orchestration, retries, timers, approvals, rollouts, retention, and disposal. Workflow state is not conversational memory.",
        "<b>Queue:</b> Asynchronous acceptance, burst absorption, retry delivery, and dead-letter handling. Queue messages carry work; they are not a memory store."
    ])
    story += section("State, Memory, and Context", bullet_items=[
        "Release instructions should be immutable, versioned, and reused without repeated broad database reads.",
        "Actor working state should remain bounded to the identity and active purpose.",
        "Long-term memory should require source, purpose, classification, expiry, DLP, and approval policy.",
        "Knowledge retrieval should add only relevant cited passages.",
        "Context budgets should summarize or omit older material to prevent latency and cost growth.",
        "Operational evidence and reusable memory must remain separate because they have different retention and deletion duties."
    ])
    story += section("Major Product Capabilities", [])
    story.append(data_table(
        ["Capability", "Business Purpose"],
        [
            ["Opportunity discovery", "Select valuable work before spending implementation effort."],
            ["Process Studio", "Define and release a controlled AI-enabled business job."],
            ["Launchpad", "Give employees one safe place to run approved work."],
            ["Work Inbox", "Keep consequential decisions attributable to humans."],
            ["Knowledge", "Ground results in approved customer content with citations."],
            ["Connections and MCP", "Expose bounded external tools without embedding credentials in prompts."],
            ["Evaluations", "Prevent releases and model changes from silently lowering quality or safety."],
            ["Activity and API Logs", "Explain executions and diagnose integrations."],
            ["Governance", "Control privacy, retention, memory, incidents, models, and emergency response."],
            ["Value and Usage", "Connect business outcomes with AI consumption and operating cost."],
            ["Help and runbooks", "Make the platform operable without permanent dependence on the implementer."]
        ],
        [2.0 * inch, 4.75 * inch]
    ))
    story += section("Security and Governance Review", bullet_items=[
        "Tenant-scoped queries and isolated customer resources are the core data boundary.",
        "Cloudflare Access identity plus Workrr membership and role establish application authorization.",
        "Credentials belong in secret storage; logs, prompts, exports, and support requests must remain secret-free.",
        "Human approval should bind to one exact proposal and remain distinct from action completion evidence.",
        "Retirement and disposal appropriately separate pausing, cooling period, independent approval, legal hold, deletion scope, and retained metadata.",
        "High-risk controls should have negative tests, conflict handling, immutable evidence, and a clearly visible recovery path."
    ])
    story += section("Scalability and Cost Review", bullet_items=[
        "Ephemeral Workers scale request compute naturally; code must never rely on in-memory persistence between requests.",
        "Durable actors scale by identity, allowing many instances of the same definition for separate consumers or entities.",
        "D1 read cost makes broad repeated prompt and state assembly undesirable. Prefer bounded indexed reads and actor-local working state.",
        "Queues and Workflows isolate burst and long-duration orchestration from request latency.",
        "Model cost will usually dominate well-designed metadata reads, but long contexts, retries, and broad retrieval can change that quickly.",
        "Operational dashboards should track context size, model calls per execution, retry amplification, actor state size, and scheduled volume."
    ])
    story += section("User Experience Review", [
        "The visual language is distinctive and credible: restrained green, clear cards, readable operational evidence, and consistent icons. The recent grouped navigation improves orientation. The Help Center is becoming a meaningful product feature rather than a support afterthought.",
        "The largest UX challenge is density. Advanced governance screens can expose many controls at once. Continue using progressive disclosure, plain-language introductions, examples, defaults, and role-specific views. Destructive controls require especially careful checkbox, label, spacing, and evidence presentation."
    ])
    story += section("Strengths", bullet_items=[
        "Clear business-process philosophy instead of generic agent abstraction.",
        "Cloudflare-native consistency across compute, state, AI, orchestration, storage, and access.",
        "Explicit distinction between duplicate durable actors and ephemeral instant execution.",
        "Production-oriented release, evaluation, approval, observability, and recovery model.",
        "Customer delivery features: setup, roles, training, support, runbooks, value, and solution packs.",
        "Aggressive but coherent MVP scope aimed at real private AI adoption."
    ])
    story += section("Key Risks", bullet_items=[
        "Breadth can make the application feel harder than the manual process it replaces.",
        "A platform without a repeatable sales discovery and implementation method can become expensive custom consulting.",
        "D1 and model consumption can grow if context assembly is not bounded and measured.",
        "Privacy language must remain precise when external gateway models are introduced.",
        "Roles, ownership, and notifications need real customer testing to prevent unowned operational work.",
        "Open-source packaging must clearly separate safe reusable framework code from customer secrets and environment-specific configuration."
    ])
    story += section("Recommended Product Priorities", [])
    story.append(data_table(
        ["Priority", "Recommendation", "Why"],
        [
            ["P0", "Complete end-to-end pilot journey for one process pattern", "Proves discovery, build, run, approve, evidence, value, and support as one product."],
            ["P0", "Continue visual QA for dense and destructive controls", "Trust is damaged quickly by misaligned governance interfaces."],
            ["P0", "Instrument context, D1 read, model call, retry, and actor-state economics", "Makes the Cloudflare design measurable and protects margins."],
            ["P1", "Create solution-pack templates and acceptance suites", "Converts services learning into reusable delivery leverage."],
            ["P1", "Add guided in-product implementation milestones", "Helps customers without development staff understand the next safe action."],
            ["P1", "Formalize gateway provider policy and customer disclosure", "Prepares secondary models without weakening the Cloudflare-first trust story."],
            ["P2", "Publish open-source boundary and contribution model", "Supports media and community goals while preserving a clear commercial offer."]
        ],
        [0.7 * inch, 2.9 * inch, 3.15 * inch]
    ))
    story += section("Suggested Acceptance Gates Before Broad Commercial Release", bullet_items=[
        "Two customer pilots complete the full process lifecycle with named owners.",
        "Production support and recovery can be performed from the application without CLI access.",
        "Every high-risk action has a human-readable confirmation, audit event, and tested failure path.",
        "Usage reporting reconciles enough of model, storage, and execution consumption to support customer budgets.",
        "A new forward-deployed engineer can deploy, configure, and hand off a customer using the written playbook.",
        "A customer administrator can understand roles, privacy, memory, approvals, and support using the Help Center."
    ])
    return build_pdf(
        "workrr-in-depth-software-review.pdf",
        "Workrr In-Depth Software Review",
        "Architecture, product capability, governance, scalability, user experience, risks, and recommended priorities.",
        "Product leadership, engineering, security reviewers, partners, and forward-deployed engineers",
        story
    )


def discovery_checklist():
    story = []
    story += section("How to Use This Checklist", [
        "Use this guide during a 45 to 90 minute discovery conversation. The objective is not to sell every Workrr feature. The objective is to determine whether one manual process is valuable, bounded, measurable, and owned enough for a pilot.",
        "Mark each item as Known, Unknown, or Blocked. Unknown is acceptable during discovery. Blocked means the pilot should not proceed until the issue has an owner and resolution."
    ])
    story.append(callout(
        "Qualification rule",
        "A good pilot has a real repeated process, a named business owner, representative examples, an acceptable human-control boundary, and a measurable baseline."
    ))

    def checklist(title, items):
        flow = [p(title, "H2Workrr")]
        rows = []
        for item in items:
            rows.append([
                p("[ ]", "Check"),
                p(item, "Check"),
                p("Known [ ]   Unknown [ ]   Blocked [ ]", "SmallWorkrr"),
                p("Notes: ____________________________________", "SmallWorkrr")
            ])
        table = Table(rows, colWidths=[0.4 * inch, 3.1 * inch, 1.45 * inch, 1.8 * inch])
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [WHITE, PALE]),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        flow.append(table)
        return flow

    story += checklist("1. Company and Strategy", [
        "What business outcome is leadership trying to improve this year?",
        "Why is AI or automation being considered now?",
        "Who is the executive sponsor and who owns the operating result?",
        "What previous automation or AI attempts exist, and what happened?",
        "What privacy, security, contractual, or regulatory requirements shape the project?",
        "Does the customer have internal development, IT, security, and operations support?"
    ])
    story += checklist("2. Process Definition", [
        "What is the process called in ordinary business language?",
        "What event starts the process?",
        "Who performs it today and for which customer, employee, or department?",
        "What are the steps in the normal path?",
        "What are the most common exceptions and judgment calls?",
        "What input arrives, in what format, and from which source?",
        "What output or action marks successful completion?",
        "Which systems are read and which systems are changed?",
        "What work occurs before and after this process?",
        "Who can explain the process when the documented procedure and real work differ?"
    ])
    story += checklist("3. Volume, Pain, and Baseline", [
        "How many items occur per day, week, or month?",
        "How many minutes does a normal item take?",
        "How much time is spent on exceptions, rework, searching, or waiting?",
        "What is the current error, reassignment, escalation, or abandonment rate?",
        "What service-level or turnaround target exists?",
        "What backlog, staffing, customer, compliance, or revenue impact does the problem create?",
        "Can the team provide a credible baseline rather than a rough savings claim?"
    ])
    story += checklist("4. Data and Knowledge", [
        "What data fields are necessary for the process?",
        "Which data is personal, confidential, regulated, or contractually restricted?",
        "Where are the source documents or records stored?",
        "Who owns source accuracy and freshness?",
        "Does output require citations or traceability to a source?",
        "What data must never enter a model, prompt, log, export, or support request?",
        "How long should inputs, outputs, conversation state, memory, and audit evidence remain?",
        "Are deletion, legal hold, residency, or customer consent requirements present?"
    ])
    story += checklist("5. Decisions and Human Control", [
        "Which steps are lookup, drafting, recommendation, decision, or external action?",
        "What can the AI observe without risk?",
        "What can it suggest without taking action?",
        "What exact actions require human approval?",
        "Who is permitted to approve, reject, request information, or escalate?",
        "What evidence must a reviewer see before deciding?",
        "What actions should never be automated?",
        "What is the worst credible outcome and how would the team contain it?"
    ])
    story += checklist("6. Integrations and Tools", [
        "Which external systems are required for the pilot?",
        "Is each interaction read-only or a write action?",
        "Are APIs, webhooks, OAuth, service accounts, or MCP interfaces available?",
        "What scopes and credentials are required, and who owns them?",
        "Can repeated actions be prevented with an idempotency key or provider reference?",
        "What rate limits, maintenance windows, or provider outages must be handled?",
        "Is a manual fallback available when the integration is unavailable?"
    ])
    story += checklist("7. Agent and Execution Design", [
        "Is each request independent, or must it continue a conversation or entity history?",
        "If state is sticky, what identity key separates threads, consumers, customers, cases, or accounts?",
        "Does work need multiple durable steps, timers, retries, approvals, or schedules?",
        "Can volume arrive in bursts that require a queue?",
        "What temporary working state is needed?",
        "What facts, if any, qualify for governed long-term memory?",
        "What context can be summarized, expired, or retrieved only when relevant?"
    ])
    story += checklist("8. Quality and Acceptance", [
        "What does a good result look like to the business owner?",
        "What errors are tolerable, reviewable, or prohibited?",
        "Can the customer supply representative normal and difficult examples?",
        "What golden scenarios must every release pass?",
        "How will citations, structured output, tools, and prohibited content be evaluated?",
        "Who has final acceptance authority for the pilot?",
        "What threshold pauses or ends the pilot?"
    ])
    story += checklist("9. Pilot and Adoption", [
        "Who are the named pilot users?",
        "How many users and items are in the pilot?",
        "What training do consumers, reviewers, owners, and operators need?",
        "Where will users start the process and receive assigned work?",
        "How will feedback and unexpected results be reported?",
        "Who provides first response and what are the support hours?",
        "What is the pilot start, review cadence, and end decision date?"
    ])
    story += checklist("10. Value and Commercial Fit", [
        "What measured result would justify the pilot?",
        "How will time returned, quality, turnaround, and business outcome be calculated?",
        "What model, integration, implementation, and operating costs matter?",
        "What is the customer's acceptable payback period?",
        "If the pilot succeeds, what related processes or departments could follow?",
        "Is the buyer seeking software, implementation, managed operation, or a combination?",
        "Is budget authority present and is the timing real?"
    ])
    story += section("Pilot Readiness Score", [])
    story.append(data_table(
        ["Dimension", "0 - Not Ready", "1 - Partial", "2 - Ready"],
        [
            ["Owner", "No accountable owner", "Interested stakeholder", "Named owner with authority"],
            ["Process", "Unclear or highly variable", "Normal path known", "Steps and exceptions understood"],
            ["Data", "Unavailable or prohibited", "Some access unresolved", "Representative approved data available"],
            ["Value", "No baseline", "Rough estimate", "Measurable baseline and target"],
            ["Control", "Authority unclear", "Review concept exists", "Exact approval and stop boundaries defined"],
            ["Acceptance", "Demo quality only", "Some examples", "Golden cases and accepting owner"],
            ["Adoption", "No users or support", "Potential users", "Named pilot users and support owner"]
        ],
        [1.05 * inch, 1.9 * inch, 1.9 * inch, 1.9 * inch]
    ))
    story += section("Scoring Guidance", bullet_items=[
        "12 to 14: Strong pilot candidate. Confirm commercial scope and implementation plan.",
        "8 to 11: Promising, but resolve the lowest-scoring dimensions before committing to production timing.",
        "4 to 7: Continue discovery or choose a more bounded process.",
        "0 to 3: Do not build yet. The problem, owner, data, or value case is not ready."
    ])
    story += section("Required Discovery Outputs", bullet_items=[
        "One-sentence process purpose and target outcome.",
        "Current-state process map with normal path and exceptions.",
        "Baseline volume, time, quality, turnaround, and cost assumptions.",
        "Named executive sponsor, business owner, technical contact, reviewers, and support owner.",
        "Data classification, retention, model, integration, and human-control boundaries.",
        "Pilot users, golden scenarios, acceptance thresholds, stop conditions, and decision date.",
        "Open questions, blockers, responsible owners, and due dates."
    ])
    return build_pdf(
        "workrr-sales-discovery-checklist.pdf",
        "Workrr Sales Discovery Checklist",
        "A structured qualification and process-discovery guide for finding safe, valuable private AI implementations.",
        "Sales, founders, consultants, forward-deployed engineers, and customer process owners",
        story
    )


if __name__ == "__main__":
    generated = [
        elevator_pitch(),
        marketing_plan(),
        software_review(),
        discovery_checklist()
    ]
    for path in generated:
        print(path)
