import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, CircleHelp, Clock3,
  GraduationCap, Route, ShieldCheck, Sparkles
} from "lucide-react";
import { api, type HelpCenterData, type SessionData } from "./api";
import "./help-center.css";

export function HelpCenterView({ session, onNotice }: {
  session: SessionData | null;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<HelpCenterData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

    <section className="help-section">
      <div className="section-head"><div><h2>Your learning path</h2>
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
      <div className="section-head"><div><h2>How Workrr executes work</h2>
        <p>The important distinctions behind agents, memory, orchestration, and human control.</p></div></div>
      <div className="concept-grid">{data.concepts.map((concept) =>
        <article className="panel concept-card" key={concept.name}><CircleHelp size={18}/>
          <div><strong>{concept.name}</strong><p>{concept.detail}</p></div></article>)}</div>
    </section>

    <section className="help-section">
      <div className="section-head"><div><h2>Process operating procedures</h2>
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
