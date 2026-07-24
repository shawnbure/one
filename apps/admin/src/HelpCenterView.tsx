import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, CircleHelp, Clock3,
  GraduationCap, LifeBuoy, Route, Search, Send, ShieldCheck, Sparkles, Users
} from "lucide-react";
import { api, type HelpCenterData, type SessionData } from "./api";
import { productGuide } from "./help-guide";
import "./help-center.css";
import "./help-operations.css";

export function HelpCenterView({ session, onNotice }: {
  session: SessionData | null;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<HelpCenterData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [guideQuery, setGuideQuery] = useState("");
  const [requestForm, setRequestForm] = useState({
    category: "how_to", priority: "normal", subject: "", detail: "", blueprintId: "", executionId: ""
  });
  const [requestEdits, setRequestEdits] = useState<Record<string, {
    status: "open" | "in_progress" | "resolved"; assignedTo: string; resolution: string;
  }>>({});

  async function load() {
    try { setData((await api.helpCenter()).data); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Help Center could not be loaded"); }
  }
  useEffect(() => { void load(); }, []);

  const runbooks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data?.processRunbooks ?? [];
    return (data?.processRunbooks ?? []).filter((item) =>
      `${item.name} ${item.purpose} ${item.business_owner} ${item.department}`.toLowerCase().includes(normalized));
  }, [data?.processRunbooks, query]);
  const guideSections = useMemo(() => {
    const normalized = guideQuery.trim().toLowerCase();
    if (!normalized) return productGuide;
    return productGuide.flatMap((section) => {
      const sectionMatch = `${section.title} ${section.summary}`.toLowerCase().includes(normalized);
      const topics = sectionMatch ? section.topics : section.topics.filter((topic) =>
        `${topic.title} ${topic.plain} ${topic.details.join(" ")}`.toLowerCase().includes(normalized));
      return topics.length ? [{ ...section, topics }] : [];
    });
  }, [guideQuery]);

  async function acknowledge(id: string, version: number) {
    setBusy(id);
    try {
      const result = await api.acknowledgeLearning(id, version);
      onNotice(result.data.recorded ? "Training acknowledgement recorded." : "Training was already acknowledged.");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Acknowledgement could not be recorded");
    } finally { setBusy(null); }
  }

  async function submitRequest() {
    setBusy("new-request");
    try {
      await api.createHelpRequest({
        category: requestForm.category, priority: requestForm.priority,
        subject: requestForm.subject, detail: requestForm.detail,
        blueprintId: requestForm.blueprintId || undefined, executionId: requestForm.executionId || undefined
      });
      setRequestForm({ category: "how_to", priority: "normal", subject: "", detail: "", blueprintId: "", executionId: "" });
      onNotice("Help request created with a response due time.");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Help request could not be created");
    } finally { setBusy(null); }
  }

  async function updateRequest(request: HelpCenterData["supportRequests"][number]) {
    const edit = requestEdits[request.id] ?? {
      status: request.status, assignedTo: request.assigned_to ?? "", resolution: ""
    };
    setBusy(request.id);
    try {
      await api.updateHelpRequest(request.id, {
        status: edit.status, assignedTo: edit.assignedTo || undefined,
        resolution: edit.status === "resolved" ? edit.resolution : undefined,
        expectedRevision: request.revision
      });
      onNotice(edit.status === "resolved" ? "Help request resolved with evidence." : "Help request ownership updated.");
      setRequestEdits((current) => { const next = { ...current }; delete next[request.id]; return next; });
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Help request could not be updated");
    } finally { setBusy(null); }
  }

  if (!data) return <section className="panel help-loading"><BookOpen size={20}/><span>Loading role guidance…</span></section>;
  const percent = data.progress.total ? Math.round(data.progress.completed / data.progress.total * 100) : 100;

  return <div className="help-center">
    <section className="page-title help-title">
      <div><span className="eyebrow"><GraduationCap size={14}/> LEARNING & OPERATIONS</span>
        <h1>Help Center</h1>
        <p>Plain-language guidance for operating this private AI environment without a development team.</p></div>
      <span className="role-chip"><ShieldCheck size={16}/>{data.roleGuide.title}</span>
    </section>

    <section className="help-summary">
      <article className="panel role-start"><span className="help-icon"><Sparkles size={20}/></span>
        <div><small>START HERE · {session?.user.name ?? "SIGNED-IN USER"}</small>
          <h2>{data.roleGuide.firstAction}</h2>
          <p><strong>When to escalate:</strong> {data.roleGuide.escalation}</p></div></article>
      <article className="panel training-progress">
        <div className="progress-ring" style={{ "--progress": `${percent * 3.6}deg` } as React.CSSProperties}>
          <span>{percent}%</span></div>
        <div><small>ROLE TRAINING</small><strong>{data.progress.completed} of {data.progress.total} complete</strong>
          <p>Acknowledgements are versioned and tenant-audited.</p></div>
      </article>
    </section>

    <section className="help-handbook" aria-labelledby="handbook-title">
      <div className="handbook-hero panel">
        <div>
          <span className="eyebrow"><BookOpen size={14}/> COMPLETE PRODUCT GUIDE</span>
          <h2 id="handbook-title">The Workrr Handbook</h2>
          <p>Learn what the whole application does, why each part exists, and how to use it safely. Every explanation starts with the simple version and then adds the important details.</p>
        </div>
        <label className="handbook-search"><Search size={17}/>
          <input value={guideQuery} onChange={(event) => setGuideQuery(event.target.value)}
            placeholder="Search processes, memory, fields, costs…" aria-label="Search the Workrr handbook"/>
        </label>
      </div>
      <nav className="handbook-nav" aria-label="Handbook chapters">
        {productGuide.map((section) => <a key={section.id} href={`#help-${section.id}`}>{section.title}</a>)}
      </nav>
      <div className="handbook-chapters">
        {guideSections.map((section, index) => <article className="panel handbook-chapter"
          id={`help-${section.id}`} key={section.id}>
          <header>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><h2>{section.title}</h2><p>{section.summary}</p></div>
          </header>
          <div className="handbook-topics">{section.topics.map((topic) =>
            <details className="handbook-topic" key={topic.title} open={guideQuery.trim().length > 0}>
              <summary><span><strong>{topic.title}</strong><small>{topic.plain}</small></span><ChevronDown size={18}/></summary>
              <div><p className="simple-label">In practical terms</p><p>{topic.plain}</p>
                <ul>{topic.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></div>
            </details>)}</div>
        </article>)}
        {!guideSections.length && <div className="panel handbook-empty">
          <CircleHelp size={20}/><strong>No handbook chapter matched “{guideQuery}”.</strong>
          <button onClick={() => setGuideQuery("")}>Clear Search</button>
        </div>}
      </div>
    </section>

    <section className="help-section support-section">
      <div className="section-head"><div><h2>Get Operational Help</h2>
        <p>Ask for assistance without losing the tenant, process, or execution context.</p></div></div>
      <div className="support-grid">
        <article className="panel support-form">
          <div className="support-card-title"><span className="help-icon"><LifeBuoy size={18}/></span>
            <div><h3>Create a Help Request</h3><p>Do not include credentials, tokens, or unnecessary personal data.</p></div></div>
          <div className="support-fields">
            <label>Category<select value={requestForm.category}
              onChange={(event) => {
                const category = event.target.value;
                setRequestForm({ ...requestForm, category,
                  priority: ["incident", "privacy"].includes(category) ? "high" : requestForm.priority });
              }}>
              <option value="how_to">How-to question</option><option value="unexpected_result">Unexpected AI result</option>
              <option value="access">Access problem</option><option value="incident">Operational incident</option>
              <option value="privacy">Privacy concern</option></select></label>
            <label>Priority<select value={requestForm.priority}
              disabled={["incident", "privacy"].includes(requestForm.category)}
              onChange={(event) => setRequestForm({ ...requestForm, priority: event.target.value })}>
              <option value="low">Low · due in 3 days</option><option value="normal">Normal · due in 1 day</option>
              <option value="high">High · due in 4 hours</option></select></label>
          </div>
          <label>Subject<input maxLength={120} placeholder="What do you need help with?" value={requestForm.subject}
            onChange={(event) => setRequestForm({ ...requestForm, subject: event.target.value })}/></label>
          <label>Details<textarea maxLength={2000} placeholder="Describe what happened, what you expected, and the safe next action you need."
            value={requestForm.detail} onChange={(event) => setRequestForm({ ...requestForm, detail: event.target.value })}/></label>
          <div className="support-fields">
            <label>Process <small>optional</small><select value={requestForm.blueprintId}
              onChange={(event) => setRequestForm({ ...requestForm, blueprintId: event.target.value })}>
              <option value="">No process selected</option>
              {data.processRunbooks.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
            </select></label>
            <label>Execution ID <small>optional</small><input maxLength={120} placeholder="Paste the exact execution ID"
              value={requestForm.executionId} onChange={(event) => setRequestForm({ ...requestForm, executionId: event.target.value })}/></label>
          </div>
          <button className="primary support-submit" disabled={busy === "new-request" ||
            requestForm.subject.trim().length < 5 || requestForm.detail.trim().length < 10}
            onClick={() => void submitRequest()}><Send size={15}/>{busy === "new-request" ? "Creating…" : "Create help request"}</button>
        </article>

        <article className="panel support-queue">
          <div className="support-card-title"><span className="help-icon"><LifeBuoy size={18}/></span>
            <div><h3>{data.supportAccess.canManage ? "Support Queue" : "Your Requests"}</h3>
              <p>{data.supportRequests.filter((item) => item.status !== "resolved").length} request(s) need a next action.</p></div></div>
          <div className="support-request-list">{data.supportRequests.length ? data.supportRequests.map((request) => {
            const edit = requestEdits[request.id] ?? {
              status: request.status, assignedTo: request.assigned_to ?? "", resolution: ""
            };
            return <div className={`support-request ${request.status}`} key={request.id}>
              <div className="support-request-head"><span className={`support-priority ${request.priority}`}>{request.priority}</span>
                <span className={`support-status ${request.status}`}>{request.status.replaceAll("_", " ")}</span>
                <time>Due {formatDateTime(request.due_at)}</time></div>
              <strong>{request.subject}</strong>
              <p>{request.detail}</p>
              <small>{request.requester_name ?? "Current user"} · {request.process_name ?? "General help"}
                {request.execution_id ? ` · execution ${request.execution_id.slice(0, 8)}` : ""}</small>
              {request.resolution && <div className="support-resolution"><CheckCircle2 size={15}/><span>
                <strong>Resolution</strong>{request.resolution}</span></div>}
              {data.supportAccess.canManage && request.status !== "resolved" && <div className="support-manage">
                <select aria-label={`Status for ${request.subject}`} value={edit.status}
                  onChange={(event) => setRequestEdits({ ...requestEdits, [request.id]: {
                    ...edit, status: event.target.value as typeof edit.status } })}>
                  <option value="open">Open</option><option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option></select>
                <select aria-label={`Owner for ${request.subject}`} value={edit.assignedTo}
                  onChange={(event) => setRequestEdits({ ...requestEdits, [request.id]: {
                    ...edit, assignedTo: event.target.value } })}>
                  <option value="">Unassigned</option>{data.supportOwners.map((owner) =>
                    <option key={owner.id} value={owner.id}>{owner.display_name} · {owner.role}</option>)}
                </select>
                {edit.status === "resolved" && <textarea aria-label={`Resolution for ${request.subject}`}
                  placeholder="Required resolution evidence…" maxLength={2000} value={edit.resolution}
                  onChange={(event) => setRequestEdits({ ...requestEdits, [request.id]: {
                    ...edit, resolution: event.target.value } })}/>}
                <button disabled={busy === request.id || (edit.status === "resolved" && edit.resolution.trim().length < 10)}
                  onClick={() => void updateRequest(request)}>Save</button>
              </div>}
            </div>;
          }) : <p className="help-empty">No help requests yet.</p>}</div>
        </article>
      </div>
    </section>

    {data.supportAccess.canViewTeamProgress && <section className="help-section">
      <div className="section-head"><div><h2>Team Training Readiness</h2>
        <p>Current-version completion for active organization members.</p></div>
        <span className="team-count"><Users size={15}/>{data.teamProgress.length} active members</span></div>
      <div className="panel team-progress-table">
        <div className="team-progress-head"><span>Member</span><span>Role</span><span>Completion</span><span>Last acknowledgement</span></div>
        {data.teamProgress.map((member) => {
          const memberPercent = member.total ? Math.round(member.completed / member.total * 100) : 100;
          return <div className="team-progress-row" key={member.id}>
            <span><strong>{member.display_name}</strong><small>{member.email}</small></span>
            <span className="role-label">{member.role}</span>
            <span><span className="completion-bar"><i style={{ width: `${memberPercent}%` }}/></span>
              <small>{member.completed} / {member.total} · {memberPercent}%</small></span>
            <time>{member.last_acknowledged_at ? formatDate(member.last_acknowledged_at) : "Not started"}</time>
          </div>;
        })}
      </div>
    </section>}

    <section className="help-section">
      <div className="section-head"><div><h2>Your Learning Path</h2>
        <p>Short operating modules selected for your current role.</p></div></div>
      <div className="learning-grid">{data.modules.map((module) =>
        <article className={`panel learning-card ${module.acknowledgedAt ? "complete" : ""}`} key={module.id}>
          <div className="learning-card-head"><span className="help-icon"><BookOpen size={18}/></span>
            <span><small><Clock3 size={12}/>{module.minutes} MIN · VERSION {module.version}</small>
              <h3>{module.title}</h3></span>
            {module.acknowledgedAt && <CheckCircle2 className="complete-icon" size={20}/>}</div>
          <p>{module.summary}</p>
          <ol>{module.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <button className={module.acknowledgedAt ? "acknowledged" : "primary"} disabled={busy === module.id}
            onClick={() => void acknowledge(module.id, module.version)}>
            {module.acknowledgedAt ? <><CheckCircle2 size={15}/>Acknowledged {formatDate(module.acknowledgedAt)}</>
              : <><GraduationCap size={15}/>{busy === module.id ? "Recording…" : "Acknowledge training"}</>}
          </button>
        </article>)}</div>
    </section>

    <section className="help-section">
      <div className="section-head"><div><h2>How Workrr Executes Work</h2>
        <p>The important distinctions behind agents, memory, orchestration, and human control.</p></div></div>
      <div className="concept-grid">{data.concepts.map((concept) =>
        <article className="panel concept-card" key={concept.name}><CircleHelp size={18}/>
          <div><strong>{concept.name}</strong><p>{concept.detail}</p></div></article>)}</div>
    </section>

    <section className="help-section">
      <div className="section-head"><div><h2>Process Operating Procedures</h2>
        <p>Live, tenant-specific runbooks derived from each configured process.</p></div>
        <input className="runbook-search" aria-label="Find a process runbook" placeholder="Find a process…"
          value={query} onChange={(event) => setQuery(event.target.value)}/></div>
      <div className="runbook-list">{runbooks.length ? runbooks.map((runbook) =>
        <article className="panel runbook" key={runbook.id}>
          <button className="runbook-toggle" onClick={() => setExpanded(expanded === runbook.id ? null : runbook.id)}
            aria-expanded={expanded === runbook.id}>
            <span className="help-icon"><Route size={18}/></span>
            <span><strong>{runbook.name}</strong><small>{runbook.department} · owner {runbook.business_owner}</small></span>
            <span className={`runbook-state ${runbook.status}`}>{runbook.status}</span>
            <span className="runbook-profile">{runbook.execution_profile.replaceAll("_", " ")} · {runbook.autonomy}</span>
            <ChevronDown className={expanded === runbook.id ? "open" : ""} size={18}/>
          </button>
          {expanded === runbook.id && <div className="runbook-detail">
            <div><h3>Purpose</h3><p>{runbook.purpose}</p><h3>Standard procedure</h3>
              <ol>{runbook.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
            <aside className="runbook-safety"><h3>State and memory</h3><p>{runbook.memory}</p>
              <h3>Where to begin</h3><p>{runbook.start}</p>
              <div><AlertTriangle size={16}/><p><strong>Exception path</strong>{runbook.exception}</p></div></aside>
          </div>}
        </article>) : <div className="panel help-empty">No process runbooks match this search.</div>}</div>
    </section>
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(new Date(value));
}
