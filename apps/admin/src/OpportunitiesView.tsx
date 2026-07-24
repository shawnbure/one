import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Download, Gauge, Plus, RefreshCw, Sparkles } from "lucide-react";
import { api, type Member, type OpportunityReadinessData, type OpportunityRevision, type ProcessOpportunity,
  type ProcessTemplate, type SessionData } from "./api";
import "./opportunities.css";

export function OpportunitiesView({ session, onNotice, onProcessCreated }: {
  session: SessionData | null;
  onNotice: (message: string) => void;
  onProcessCreated: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<ProcessOpportunity[]>([]);
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showCapture, setShowCapture] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [history, setHistory] = useState<Record<string, OpportunityRevision[]>>({});
  const [readiness, setReadiness] = useState<Record<string, OpportunityReadinessData>>({});
  const [readinessDrafts, setReadinessDrafts] = useState<Record<string, {
    status: "open" | "confirmed" | "not_applicable"; evidence: string; ownerId: string; dueAt: string;
  }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "", purpose: "", businessOwner: "", department: "Operations", currentSteps: "",
    systems: "", exceptions: "", volumePerMonth: 100, minutesPerItem: 10, hourlyCost: 40,
    errorRate: 5, riskLevel: "medium", dataClassification: "internal", externalAction: false,
    humanJudgment: "some", recommendedTemplateId: ""
  });
  async function load() {
    try {
      const [opportunities, processTemplates, organizationMembers] =
        await Promise.all([api.opportunities(), api.processTemplates(), api.members()]);
      setItems(opportunities.data);
      setTemplates(processTemplates.data);
      setMembers(organizationMembers.data.filter((member) => member.status === "active" && member.role !== "consumer"));
      setSelectedTemplates(Object.fromEntries(opportunities.data.map((item) =>
        [item.id, item.recommended_template_id ?? processTemplates.data[0]?.id ?? ""])));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Opportunity backlog could not load"); }
  }
  useEffect(() => { void load(); }, []);
  const canCapture = Boolean(session && ["admin", "builder", "owner", "operator"].includes(session.user.role));
  const canQualify = Boolean(session && ["admin", "builder", "owner"].includes(session.user.role));
  const summary = useMemo(() => ({
    active: items.filter((item) => ["captured", "qualified", "approved"].includes(item.status)).length,
    highPriority: items.filter((item) => item.priority_score >= 70 && item.status !== "converted").length,
    converted: items.filter((item) => item.status === "converted").length
  }), [items]);
  async function capture(event: React.FormEvent) {
    event.preventDefault();
    setBusy("capture");
    try {
      const payload = {
        ...form,
        systems: splitList(form.systems), exceptions: splitList(form.exceptions),
        errorRate: form.errorRate / 100,
        recommendedTemplateId: form.recommendedTemplateId || null
      };
      const current = editingId ? items.find((item) => item.id === editingId) : null;
      const result = current
        ? await api.updateOpportunity(current.id, { ...payload, expectedRevision: current.revision, changeReason })
        : await api.createOpportunity(payload);
      setShowCapture(false);
      setEditingId(null);
      setChangeReason("");
      setForm((current) => ({ ...current, name: "", purpose: "", currentSteps: "", systems: "", exceptions: "" }));
      await load();
      onNotice(current
        ? `Evidence revised as version ${"revision" in result.data ? result.data.revision : current.revision + 1}; qualification reset for review.`
        : `Opportunity captured with priority ${result.data.priorityScore}/100.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Opportunity could not be captured"); }
    finally { setBusy(null); }
  }
  function edit(item: ProcessOpportunity) {
    setEditingId(item.id);
    setChangeReason("");
    setForm({
      name: item.name, purpose: item.purpose, businessOwner: item.business_owner, department: item.department,
      currentSteps: item.current_steps, systems: parseList(item.systems_json).join("\n"),
      exceptions: parseList(item.exceptions_json).join("\n"), volumePerMonth: Number(item.volume_per_month),
      minutesPerItem: Number(item.minutes_per_item), hourlyCost: Number(item.hourly_cost),
      errorRate: Number(item.error_rate) * 100, riskLevel: item.risk_level,
      dataClassification: item.data_classification, externalAction: Boolean(item.external_action),
      humanJudgment: item.human_judgment, recommendedTemplateId: item.recommended_template_id ?? ""
    });
    setShowCapture(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function toggleHistory(item: ProcessOpportunity) {
    if (history[item.id]) {
      setHistory((current) => { const next = { ...current }; delete next[item.id]; return next; });
      return;
    }
    try {
      setHistory({ ...history, [item.id]: (await api.opportunityRevisions(item.id)).data });
    } catch (error) { onNotice(error instanceof Error ? error.message : "Opportunity history could not load"); }
  }
  async function toggleReadiness(item: ProcessOpportunity) {
    if (readiness[item.id]) {
      setReadiness((current) => { const next = { ...current }; delete next[item.id]; return next; });
      return;
    }
    try {
      const data = (await api.opportunityReadiness(item.id)).data;
      setReadiness({ ...readiness, [item.id]: data });
      setReadinessDrafts((current) => ({ ...current, ...Object.fromEntries(data.checks.map((check) => [check.id, {
        status: check.status, evidence: check.evidence ?? "", ownerId: check.owner_id ?? "",
        dueAt: check.due_at ? check.due_at.slice(0, 10) : ""
      }])) }));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Opportunity readiness could not load"); }
  }
  async function saveReadiness(item: ProcessOpportunity, checkId: string, checkKey: string) {
    const draft = readinessDrafts[checkId];
    if (!draft) return;
    setBusy(checkId);
    try {
      await api.updateOpportunityReadiness(item.id, checkKey, { ...draft, dueAt: draft.dueAt || null });
      const data = (await api.opportunityReadiness(item.id)).data;
      setReadiness({ ...readiness, [item.id]: data });
      await load();
      onNotice("Delivery-readiness evidence saved and audited.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Readiness evidence could not be saved"); }
    finally { setBusy(null); }
  }
  async function qualify(item: ProcessOpportunity, status: "qualified" | "approved" | "declined") {
    setBusy(item.id);
    try {
      await api.qualifyOpportunity(item.id, status, notes[item.id] ?? "");
      await load();
      onNotice(`${item.name} marked ${status}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Qualification could not be saved"); }
    finally { setBusy(null); }
  }
  async function convert(item: ProcessOpportunity) {
    const templateId = selectedTemplates[item.id];
    if (!templateId) return onNotice("Select a starting template before creating the process.");
    setBusy(item.id);
    try {
      const result = await api.convertOpportunity(item.id, templateId);
      await load();
      onNotice(`${item.name} is now a paused draft process with an immutable starting release.`);
      await onProcessCreated(result.data.id);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Draft process could not be created"); }
    finally { setBusy(null); }
  }
  return <section className="opportunity-page">
    <div className="page-title"><div><span className="eyebrow"><Sparkles size={14}/> AI PROCESS DISCOVERY</span>
      <h1>Opportunity Backlog</h1><p>Qualify manual work before committing engineering effort or giving an agent authority.</p></div>
      <span className="opportunity-page-actions"><button onClick={() => void load()}><RefreshCw size={15}/>Refresh</button>
        {canCapture && <button className="primary" onClick={() => setShowCapture(!showCapture)}><Plus size={15}/>Capture opportunity</button>}</span></div>
    <div className="opportunity-summary">
      <article className="panel"><BriefcaseBusiness size={19}/><span><strong>{summary.active}</strong><small>ACTIVE CANDIDATES</small></span></article>
      <article className="panel"><Gauge size={19}/><span><strong>{summary.highPriority}</strong><small>PRIORITY 70+</small></span></article>
      <article className="panel"><CheckCircle2 size={19}/><span><strong>{summary.converted}</strong><small>CONVERTED TO PROCESSES</small></span></article>
    </div>
    {showCapture && <form className="opportunity-capture panel" onSubmit={(event) => void capture(event)}>
      <div className="section-head"><div><h2>{editingId ? "Revise captured evidence" : "Capture the work as it exists today"}</h2>
        <p>{editingId ? "Material changes create an immutable revision and reset qualification." : "Use observed facts. Scores are decision support, not an approval."}</p></div></div>
      <div className="opportunity-fields">
        <label>Opportunity name<input required maxLength={140} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
        <label>Business owner<input required maxLength={160} value={form.businessOwner} onChange={(e) => setForm({ ...form, businessOwner: e.target.value })}/></label>
        <label>Department<input required maxLength={120} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}/></label>
        <label className="wide">Purpose and desired outcome<textarea required maxLength={1200} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}/></label>
        <label className="wide">Current manual steps<textarea maxLength={3000} placeholder="Receive; inspect; look up; decide; update; notify"
          value={form.currentSteps} onChange={(e) => setForm({ ...form, currentSteps: e.target.value })}/></label>
        <label>Systems <small>comma or new line</small><textarea value={form.systems} onChange={(e) => setForm({ ...form, systems: e.target.value })}/></label>
        <label>Exceptions <small>comma or new line</small><textarea value={form.exceptions} onChange={(e) => setForm({ ...form, exceptions: e.target.value })}/></label>
        <label>Items / month<input type="number" min="0" value={form.volumePerMonth} onChange={(e) => setForm({ ...form, volumePerMonth: Number(e.target.value) })}/></label>
        <label>Minutes / item<input type="number" min="0" value={form.minutesPerItem} onChange={(e) => setForm({ ...form, minutesPerItem: Number(e.target.value) })}/></label>
        <label>Loaded hourly cost<input type="number" min="0" value={form.hourlyCost} onChange={(e) => setForm({ ...form, hourlyCost: Number(e.target.value) })}/></label>
        <label>Error / rework %<input type="number" min="0" max="100" value={form.errorRate} onChange={(e) => setForm({ ...form, errorRate: Number(e.target.value) })}/></label>
        <label>Risk<select value={form.riskLevel} onChange={(e) => setForm({ ...form, riskLevel: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label>Data class<select value={form.dataClassification} onChange={(e) => setForm({ ...form, dataClassification: e.target.value })}><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></label>
        <label>Human judgment<select value={form.humanJudgment} onChange={(e) => setForm({ ...form, humanJudgment: e.target.value })}><option value="low">Low</option><option value="some">Some</option><option value="high">High</option></select></label>
        <label>Starting pattern<select value={form.recommendedTemplateId} onChange={(e) => setForm({ ...form, recommendedTemplateId: e.target.value })}><option value="">Decide during qualification</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
        <label className="opportunity-check"><input type="checkbox" checked={form.externalAction} onChange={(e) => setForm({ ...form, externalAction: e.target.checked })}/><span><strong>Changes another system</strong><small>Requires a governed tool and may require approval.</small></span></label>
        {editingId && <label className="wide">Change reason<input required maxLength={500} value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)} placeholder="What changed, who confirmed it, and why?"/></label>}
      </div>
      <span className="opportunity-form-actions"><button type="button" onClick={() => { setShowCapture(false); setEditingId(null); }}>Cancel</button>
        <button className="primary" disabled={busy === "capture" || Boolean(editingId && !changeReason.trim())}>
          {busy === "capture" ? "Saving…" : editingId ? "Save new revision" : "Add to backlog"}</button></span>
    </form>}
    <div className="opportunity-list">{items.length ? items.map((item) => <article className="opportunity-card panel" key={item.id}>
      <header><div><span className={`opportunity-status ${item.status}`}>{item.status}</span><h2>{item.name}</h2><p>{item.purpose}</p></div>
        <div className="priority-score"><strong>{item.priority_score}</strong><small>PRIORITY</small></div></header>
      <div className="score-breakdown"><span><strong>{item.impact_score}</strong> Impact</span><span><strong>{item.feasibility_score}</strong> Feasibility</span>
        <span>{item.department}</span><span>{item.risk_level} risk</span><span>{item.data_classification} data</span>
        <span className={item.conversion_check_complete === item.conversion_check_total ? "readiness-ready" : ""}>
          Conversion {item.conversion_check_complete}/{item.conversion_check_total}</span>
        <span className={item.release_check_complete === item.release_check_total ? "readiness-ready" : ""}>
          Release planning {item.release_check_complete}/{item.release_check_total}</span></div>
      <dl><div><dt>Owner</dt><dd>{item.business_owner}</dd></div><div><dt>Manual baseline</dt><dd>{item.volume_per_month}/month · {item.minutes_per_item} min/item</dd></div>
        <div><dt>Estimated effort</dt><dd>{Math.round(item.volume_per_month * item.minutes_per_item / 60)} hours/month</dd></div>
        <div><dt>External action</dt><dd>{item.external_action ? "Yes · govern the write" : "No"}</dd></div>
        <div><dt>Starting pattern</dt><dd>{item.recommended_template_name || "Not selected"}</dd></div></dl>
      {item.qualification_note && <p className="qualification-note"><strong>Qualification:</strong> {item.qualification_note}</p>}
      <div className="opportunity-evidence-actions">
        {canCapture && item.status !== "converted" && <button onClick={() => edit(item)}>Revise evidence</button>}
        <button onClick={() => void toggleHistory(item)}>{history[item.id] ? "Hide" : "View"} revision history · v{item.revision}</button>
        <button onClick={() => void toggleReadiness(item)}>{readiness[item.id] ? "Hide" : "Open"} delivery readiness</button>
      </div>
      {history[item.id] && <div className="opportunity-history">{(history[item.id] ?? []).map((revision) =>
        <article key={revision.revision}><strong>Version {revision.revision}</strong><span>{revision.change_reason || "No reason recorded"}</span>
          <small>{revision.changed_by} · {new Date(`${revision.created_at.replace(" ", "T")}Z`).toLocaleString()}</small></article>)}</div>}
      {readiness[item.id] && <div className="opportunity-readiness">
        {(["conversion", "release"] as const).map((stage) => <section key={stage}><header><div><strong>{stage === "conversion" ? "Required before process creation" : "Required before release planning completes"}</strong>
          <small>{stage === "conversion" ? "Customer decisions that block conversion." : "Implementation evidence carried into Process Studio."}</small></div>
          <span>{readiness[item.id]![stage].complete}/{readiness[item.id]![stage].total}</span></header>
          {readiness[item.id]!.checks.filter((check) => check.stage === stage).map((check) => {
            const draft = readinessDrafts[check.id] ?? { status: check.status, evidence: check.evidence ?? "",
              ownerId: check.owner_id ?? "", dueAt: check.due_at?.slice(0, 10) ?? "" };
            return <article key={check.id}><div><strong>{check.label}</strong><small>{check.owner_name || "Unassigned"}{check.due_at ? ` · due ${new Date(check.due_at).toLocaleDateString()}` : ""}</small></div>
              {canCapture && item.status !== "converted" ? <div className="readiness-editor">
                <select value={draft.status} onChange={(e) => setReadinessDrafts({ ...readinessDrafts,
                  [check.id]: { ...draft, status: e.target.value as typeof draft.status } })}>
                  <option value="open">Open</option><option value="confirmed">Confirmed</option><option value="not_applicable">Not applicable</option></select>
                <select value={draft.ownerId} onChange={(e) => setReadinessDrafts({ ...readinessDrafts,
                  [check.id]: { ...draft, ownerId: e.target.value } })}><option value="">Select owner</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.role}</option>)}</select>
                <input type="date" value={draft.dueAt} onChange={(e) => setReadinessDrafts({ ...readinessDrafts,
                  [check.id]: { ...draft, dueAt: e.target.value } })}/>
                <input className="readiness-evidence" maxLength={1500} placeholder="Specific evidence or reason…" value={draft.evidence}
                  onChange={(e) => setReadinessDrafts({ ...readinessDrafts, [check.id]: { ...draft, evidence: e.target.value } })}/>
                <button disabled={busy === check.id} onClick={() => void saveReadiness(item, check.id, check.check_key)}>Save</button>
              </div> : <p>{check.evidence || "No evidence recorded."}</p>}
            </article>;
          })}</section>)}
      </div>}
      {canQualify && !["converted", "declined"].includes(item.status) && <div className="qualification-controls">
        <textarea maxLength={1500} placeholder="Qualification evidence, constraints, and next step…" value={notes[item.id] ?? item.qualification_note ?? ""}
          onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}/>
        <span><button disabled={busy === item.id} onClick={() => void qualify(item, "declined")}>Decline</button>
          <button disabled={busy === item.id} onClick={() => void qualify(item, "qualified")}>Qualify</button>
          <button className="primary" disabled={busy === item.id} onClick={() => void qualify(item, "approved")}>Approve candidate</button></span>
      </div>}
      {canQualify && ["qualified", "approved"].includes(item.status) && <div className="conversion-controls">
        <select value={selectedTemplates[item.id] ?? ""} onChange={(e) => setSelectedTemplates({ ...selectedTemplates, [item.id]: e.target.value })}>
          <option value="">Select starting pattern</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select>
        <button className="primary" disabled={busy === item.id || item.conversion_check_total !== 4 ||
          item.conversion_check_complete !== item.conversion_check_total} onClick={() => void convert(item)}>
          {item.conversion_check_complete === item.conversion_check_total ? "Create paused draft process" : "Complete conversion readiness"}<ArrowRight size={14}/></button>
      </div>}
      {item.status === "converted" && <button className="converted-link" onClick={() => item.blueprint_id && void onProcessCreated(item.blueprint_id)}>Open {item.blueprint_name || "draft process"}<ArrowRight size={14}/></button>}
      <a className="opportunity-brief-link" href={`/api/opportunities/${encodeURIComponent(item.id)}/brief`}
        target="_blank" rel="noreferrer"><Download size={14}/>Open implementation brief</a>
    </article>) : <div className="loading-card">No opportunities captured yet.</div>}</div>
  </section>;
}

function splitList(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}
function parseList(value: string) {
  try { return JSON.parse(value) as string[]; } catch { return []; }
}
