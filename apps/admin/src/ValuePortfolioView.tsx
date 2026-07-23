import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, BarChart3, Check, CircleDollarSign, Clock3, FileCheck2, Gauge, Plus, RefreshCw, RotateCcw, ShieldCheck, TrendingUp, X } from "lucide-react";
import { api, type SessionData, type ValueData } from "./api";
import "./value-portfolio.css";

interface ValueForm {
  blueprintId: string; periodStart: string; periodEnd: string; itemsProcessed: string;
  actualHumanMinutes: string; averageCycleMinutes: string; overrideCount: string;
  failureCount: string; evidenceReference: string; note: string;
}
interface TargetForm {
  processId: string; targetItems: string; targetHumanMinutesSaved: string; targetValue: string;
  maximumOverridePercent: string; maximumFailurePercent: string; reviewDueAt: string;
  rationale: string; evidenceReference: string; expectedRevision: number;
}

export function ValuePortfolioView({ session, onNotice, onOpenProcess }: {
  session: SessionData | null; onNotice: (message: string) => void; onOpenProcess: (id: string) => void;
}) {
  const [data, setData] = useState<ValueData | null>(null);
  const [filter, setFilter] = useState("all");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [targetForm, setTargetForm] = useState<TargetForm | null>(null);
  const [form, setForm] = useState<ValueForm>(() => ({
    blueprintId: "", periodStart: monthStart(), periodEnd: today(), itemsProcessed: "",
    actualHumanMinutes: "", averageCycleMinutes: "", overrideCount: "0", failureCount: "0",
    evidenceReference: "", note: ""
  }));
  async function load() {
    try { setData((await api.value()).data); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Value portfolio could not load"); }
  }
  useEffect(() => { void load(); }, []);
  const processes = useMemo(() => data?.portfolio.filter((item) =>
    filter === "all" || item.recommendation.action === filter) ?? [], [data, filter]);
  if (!data) return <div className="loading-card">Loading value evidence…</div>;
  const canRecord = ["admin", "owner", "operator"].includes(session?.user.role ?? "");
  const canVoid = ["admin", "owner"].includes(session?.user.role ?? "");
  const canManageTarget = canVoid;
  const totals = data.totals ?? { items_processed: 0, human_minutes_saved: 0, estimated_value: 0, override_count: 0, failure_count: 0 };
  const actions = data.portfolio.reduce<Record<string, number>>((counts, item) => {
    counts[item.recommendation.action] = (counts[item.recommendation.action] ?? 0) + 1; return counts;
  }, {});
  return <section className="value-page">
    <div className="page-title"><div><span className="eyebrow"><TrendingUp size={14}/> EXECUTIVE VALUE PORTFOLIO</span>
      <h1>Value & decisions</h1><p>Measured business impact and transparent recommendations for where to expand, correct, observe, or retire.</p></div>
      <div className="value-title-actions">{canRecord && <button className="primary" onClick={() => setCaptureOpen((open) => !open)}>
        {captureOpen ? <X size={15}/> : <Plus size={15}/>}{captureOpen ? "Close capture" : "Record outcome"}</button>}
        <button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh evidence</button></div></div>
    <div className="value-metrics">
      <Metric icon={<CircleDollarSign size={18}/>} label="VALUE · 30 DAYS" value={money(totals.estimated_value)}
        detail={`${number(totals.items_processed)} measured items`} tone="green"/>
      <Metric icon={<Clock3 size={18}/>} label="TIME RETURNED" value={`${number(totals.human_minutes_saved / 60, 1)}h`}
        detail="From customer-approved baselines" tone="blue"/>
      <Metric icon={<Gauge size={18}/>} label="HUMAN OVERRIDES" value={number(totals.override_count)}
        detail="Visible correction signal" tone="amber"/>
      <Metric icon={<AlertTriangle size={18}/>} label="RECORDED FAILURES" value={number(totals.failure_count)}
        detail="Value snapshot evidence" tone="red"/>
    </div>
    <div className="decision-policy panel"><ShieldCheck size={19}/><div><strong>Explainable decision policy</strong>
      <p>Recommendations use a {data.decisionPolicy.evidenceWindowDays}-day window. Correct wins when an incident or safety cap is open,
        adverse runs exceed {data.decisionPolicy.correctAtFailurePercent}%, or overrides exceed {data.decisionPolicy.correctAtOverridePercent}%.
        Expand requires measured value and bounded exception rates. Workrr never increases autonomy automatically.</p></div></div>
    {captureOpen && <ValueCapture data={data} form={form} setForm={setForm} busy={busy} onSave={async () => {
      setBusy(true); try {
        const result = await api.recordValueMeasurement({
          blueprintId: form.blueprintId, periodStart: form.periodStart, periodEnd: form.periodEnd,
          itemsProcessed: Number(form.itemsProcessed), actualHumanMinutes: Number(form.actualHumanMinutes),
          averageCycleMinutes: form.averageCycleMinutes === "" ? null : Number(form.averageCycleMinutes),
          overrideCount: Number(form.overrideCount), failureCount: Number(form.failureCount),
          evidenceReference: form.evidenceReference, note: form.note
        });
        onNotice(`${result.data.processName}: ${money(result.data.estimatedValue)} of governed value evidence recorded.`);
        setForm({ ...form, itemsProcessed: "", actualHumanMinutes: "", averageCycleMinutes: "",
          overrideCount: "0", failureCount: "0", evidenceReference: "", note: "" });
        setCaptureOpen(false); await load();
      } catch (error) { onNotice(error instanceof Error ? error.message : "Value evidence could not be recorded"); }
      finally { setBusy(false); }
    }}/>}
    {targetForm && <TargetEditor data={data} form={targetForm} setForm={setTargetForm} busy={busy}
      onClose={() => setTargetForm(null)} onSave={async () => {
        setBusy(true); try {
          await api.updateValueTarget(targetForm.processId, {
            targetItems: Number(targetForm.targetItems),
            targetHumanMinutesSaved: Number(targetForm.targetHumanMinutesSaved),
            targetValue: Number(targetForm.targetValue),
            maximumOverridePercent: Number(targetForm.maximumOverridePercent),
            maximumFailurePercent: Number(targetForm.maximumFailurePercent),
            reviewDueAt: new Date(`${targetForm.reviewDueAt}T23:59:59Z`).toISOString(),
            rationale: targetForm.rationale, evidenceReference: targetForm.evidenceReference,
            expectedRevision: targetForm.expectedRevision
          });
          onNotice("Thirty-day process target saved and audited."); setTargetForm(null); await load();
        } catch (error) { onNotice(error instanceof Error ? error.message : "Value target could not be saved"); }
        finally { setBusy(false); }
      }}/>}
    <div className="decision-filters" role="group" aria-label="Filter portfolio recommendations">
      {(["all","expand","correct","observe","hold","retire"] as const).map((action) =>
        <button key={action} className={filter === action ? "active" : ""} onClick={() => setFilter(action)}>
          {action}<span>{action === "all" ? data.portfolio.length : actions[action] ?? 0}</span></button>)}
    </div>
    <div className="portfolio-list">
      {processes.length === 0 && <div className="panel portfolio-empty">No processes match this decision filter.</div>}
      {processes.map((item) => <article className={`value-portfolio-card panel ${item.recommendation.action}`} key={item.blueprint_id}>
        <header><div><span className="portfolio-department">{item.department || "Unassigned department"}</span>
          <h2>{item.process_name}</h2><p>{item.business_owner || "Owner not assigned"}</p></div>
          <span className={`decision-badge ${item.recommendation.action}`}>{decisionIcon(item.recommendation.action)}
            {item.recommendation.action}<small>{item.recommendation.confidence} confidence</small></span></header>
        <div className="portfolio-evidence">
          <Evidence label="Measured value" value={money(item.estimated_value)}/>
          <Evidence label="Items" value={number(item.items_processed)}/>
          <Evidence label="Time returned" value={`${number(item.human_minutes_saved / 60, 1)}h`}/>
          <Evidence label="Runs" value={number(item.runs)}/>
          <Evidence label="Adverse runs" value={`${number(item.failureRate, 1)}%`}/>
          <Evidence label="Overrides" value={`${number(item.overrideRate, 1)}%`}/>
          <Evidence label="Avg. cycle" value={duration(item.avg_cycle_ms)}/>
          <Evidence label="Open incidents" value={number(item.open_incidents)}/>
        </div>
        <TargetProgress item={item}/>
        <div className="portfolio-reason"><strong>Why this recommendation</strong><p>{item.recommendation.reason}.</p>
          <small>{item.recommendation.nextStep}</small></div>
        <footer><span>{item.status} · {item.operating_mode.replaceAll("_"," ")}
          {item.safety_autonomy_cap ? ` · safety cap ${item.safety_autonomy_cap}` : ""}</span>
          <div>{canManageTarget && <button onClick={() => setTargetForm(targetFrom(item))}>
            {item.target ? "Edit target" : "Set target"}</button>}
          <button onClick={() => onOpenProcess(item.blueprint_id)}>Open Process Studio<ArrowRight size={14}/></button></div></footer>
      </article>)}
    </div>
    <section className="measurement-history panel"><div className="section-head"><div><span className="eyebrow"><FileCheck2 size={14}/> ATTRIBUTABLE EVIDENCE</span>
      <h2>Recorded outcomes</h2><p>Corrections void the original record; they never rewrite or delete it.</p></div></div>
      {data.measurements.length === 0 && <p className="portfolio-empty">No customer-recorded outcome evidence yet.</p>}
      {data.measurements.map((item) => <article className={item.status} key={item.id}><div><strong>{item.process_name}</strong>
        <small>{item.period_start} – {item.period_end} · recorded by {item.recorded_by_name}</small></div>
        <span><strong>{number(item.items_processed)}</strong><small>items</small></span>
        <span><strong>{number(item.human_minutes_saved / 60, 1)}h</strong><small>returned</small></span>
        <span><strong>{money(item.estimated_value)}</strong><small>estimated</small></span>
        <span className={`measurement-status ${item.status}`}>{item.status}</span>
        {canVoid && item.status === "active" && (voiding === item.id ? <div className="measurement-void">
          <input value={voidReason} placeholder="Correction reason (10+ characters)" onChange={(event) => setVoidReason(event.target.value)}/>
          <button disabled={busy || voidReason.trim().length < 10} onClick={async () => {
            setBusy(true); try { await api.voidValueMeasurement(item.id, voidReason, item.revision);
              setVoiding(null); setVoidReason(""); await load(); onNotice("Value evidence voided with attributable correction.");
            } catch (error) { onNotice(error instanceof Error ? error.message : "Value evidence could not be voided"); }
            finally { setBusy(false); }
          }}>Confirm void</button><button onClick={() => { setVoiding(null); setVoidReason(""); }}>Cancel</button></div> :
          <button className="void-measurement" onClick={() => setVoiding(item.id)}>Correct</button>)}
        {item.status === "void" && <small className="void-detail">{item.void_reason} · {item.voided_by_name}</small>}
      </article>)}
    </section>
  </section>;
}

function TargetProgress({ item }: { item: ValueData["portfolio"][number] }) {
  if (!item.target) return <div className="target-missing"><Gauge size={15}/><span><strong>No 30-day target</strong>
    <small>Define volume, effort, value, and exception thresholds before expanding.</small></span></div>;
  return <div className={`target-progress ${item.target.status}`}><header><span><strong>30-day target</strong>
    <small>{item.target.status.replace("_"," ")} · review {new Date(item.target_review_due_at!).toLocaleDateString()}</small></span>
    <b>{Math.round(item.target.minimumPercent)}% minimum progress</b></header>
    <div><TargetBar label="Items" value={item.target.itemPercent}/><TargetBar label="Effort" value={item.target.effortPercent}/>
      <TargetBar label="Value" value={item.target.valuePercent}/></div>
    <p>Exceptions {item.target.exceptionReady ? "within target" : "need attention"} · maximum {item.maximum_override_percent}% overrides / {item.maximum_failure_percent}% adverse runs</p>
  </div>;
}
function TargetBar({ label, value }: { label: string; value: number }) {
  return <span><small>{label}</small><i><b style={{ width: `${Math.min(100, value)}%` }}/></i><strong>{Math.round(value)}%</strong></span>;
}

function TargetEditor({ data, form, setForm, busy, onClose, onSave }: {
  data: ValueData; form: TargetForm; setForm: (form: TargetForm) => void;
  busy: boolean; onClose: () => void; onSave: () => Promise<void>;
}) {
  const item = data.portfolio.find((process) => process.blueprint_id === form.processId);
  const valid = Number(form.targetItems) >= 1 && Number(form.targetHumanMinutesSaved) >= 0 &&
    Number(form.targetValue) >= 0 && Number(form.maximumOverridePercent) >= 0 &&
    Number(form.maximumOverridePercent) <= 100 && Number(form.maximumFailurePercent) >= 0 &&
    Number(form.maximumFailurePercent) <= 100 && form.reviewDueAt &&
    form.rationale.trim().length >= 20 && form.evidenceReference.trim().length >= 5;
  return <section className="target-editor panel"><div className="section-head"><div><span className="eyebrow"><Gauge size={14}/> OWNER-APPROVED OUTCOME</span>
    <h2>{item?.target ? "Edit" : "Set"} 30-day target · {item?.process_name}</h2>
    <p>Targets guide portfolio decisions. They never increase autonomy or change process state automatically.</p></div>
    <button onClick={onClose}><X size={15}/>Close</button></div>
    <div className="target-fields">
      <label>Target items<input type="number" min="1" value={form.targetItems} onChange={(e) => setForm({ ...form, targetItems: e.target.value })}/></label>
      <label>Target effort returned · minutes<input type="number" min="0" value={form.targetHumanMinutesSaved} onChange={(e) => setForm({ ...form, targetHumanMinutesSaved: e.target.value })}/></label>
      <label>Target value · USD<input type="number" min="0" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: e.target.value })}/></label>
      <label>Maximum overrides · %<input type="number" min="0" max="100" value={form.maximumOverridePercent} onChange={(e) => setForm({ ...form, maximumOverridePercent: e.target.value })}/></label>
      <label>Maximum adverse runs · %<input type="number" min="0" max="100" value={form.maximumFailurePercent} onChange={(e) => setForm({ ...form, maximumFailurePercent: e.target.value })}/></label>
      <label>Review due<input type="date" value={form.reviewDueAt} onChange={(e) => setForm({ ...form, reviewDueAt: e.target.value })}/></label>
      <label className="target-wide">Rationale<textarea rows={3} value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })}/></label>
      <label className="target-wide">Approval evidence reference<input value={form.evidenceReference} onChange={(e) => setForm({ ...form, evidenceReference: e.target.value })}/></label>
    </div><footer><span>Baseline: {item?.baseline_volume ?? 0} items/month · {item?.baseline_minutes ?? 0} minutes/item · {money(item?.hourly_cost ?? 0)}/hour</span>
      <button className="primary" disabled={busy || !valid} onClick={() => void onSave()}><Check size={15}/>{busy ? "Saving…" : "Save target"}</button></footer>
  </section>;
}

function targetFrom(item: ValueData["portfolio"][number]): TargetForm {
  return {
    processId: item.blueprint_id, targetItems: String(item.target_items ?? Math.max(1, item.baseline_volume)),
    targetHumanMinutesSaved: String(item.target_human_minutes_saved ?? Math.round(item.baseline_volume * item.baseline_minutes * .5)),
    targetValue: String(item.target_value ?? Math.round(item.baseline_volume * item.baseline_minutes * .5 / 60 * item.hourly_cost)),
    maximumOverridePercent: String(item.maximum_override_percent ?? 10),
    maximumFailurePercent: String(item.maximum_failure_percent ?? 5),
    reviewDueAt: item.target_review_due_at?.slice(0,10) ?? new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0,10),
    rationale: item.target_rationale ?? "", evidenceReference: item.target_evidence_reference ?? "",
    expectedRevision: item.target_revision ?? 0
  };
}

function ValueCapture({ data, form, setForm, busy, onSave }: {
  data: ValueData; form: ValueForm; setForm: (value: ValueForm) => void;
  busy: boolean; onSave: () => Promise<void>;
}) {
  const selected = data.portfolio.find((item) => item.blueprint_id === form.blueprintId);
  const items = Number(form.itemsProcessed || 0); const actual = Number(form.actualHumanMinutes || 0);
  const saved = selected ? Math.max(0, selected.baseline_minutes * items - actual) : 0;
  const projected = selected ? saved / 60 * selected.hourly_cost : 0;
  const valid = form.blueprintId && items >= 1 && actual >= 0 && Number(form.overrideCount) <= items &&
    Number(form.failureCount) <= items && form.evidenceReference.trim().length >= 5;
  return <section className="value-capture panel"><div className="section-head"><div><h2>Record measured business outcome</h2>
    <p>Enter aggregate evidence only. Workrr calculates effort returned from the customer-approved discovery baseline.</p></div>
    <span><strong>{number(saved / 60, 1)}h</strong><small>{money(projected)} modeled value</small></span></div>
    <div className="value-capture-grid">
      <label>Process<select value={form.blueprintId} onChange={(e) => setForm({ ...form, blueprintId: e.target.value })}>
        <option value="">Choose a process</option>{data.portfolio.map((item) =>
          <option value={item.blueprint_id} key={item.blueprint_id}>{item.process_name}</option>)}</select></label>
      <label>Period start<input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })}/></label>
      <label>Period end<input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}/></label>
      <label>Items processed<input type="number" min="1" value={form.itemsProcessed} onChange={(e) => setForm({ ...form, itemsProcessed: e.target.value })}/></label>
      <label>Actual human minutes<input type="number" min="0" value={form.actualHumanMinutes} onChange={(e) => setForm({ ...form, actualHumanMinutes: e.target.value })}/></label>
      <label>Average cycle minutes <small>optional</small><input type="number" min="0" value={form.averageCycleMinutes} onChange={(e) => setForm({ ...form, averageCycleMinutes: e.target.value })}/></label>
      <label>Human overrides<input type="number" min="0" value={form.overrideCount} onChange={(e) => setForm({ ...form, overrideCount: e.target.value })}/></label>
      <label>Failures<input type="number" min="0" value={form.failureCount} onChange={(e) => setForm({ ...form, failureCount: e.target.value })}/></label>
      <label>Evidence reference<input value={form.evidenceReference} placeholder="Report, ticket, or customer evidence ID"
        onChange={(e) => setForm({ ...form, evidenceReference: e.target.value })}/></label>
      <label className="capture-note">Notes <small>optional; DLP protected</small><textarea rows={3} value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}/></label>
    </div>
    <footer><p>{selected ? `${selected.baseline_minutes} baseline minutes/item · ${money(selected.hourly_cost)}/hour` :
      "Select a process to load its approved baseline."}</p>
      <button className="primary" disabled={busy || !valid} onClick={() => void onSave()}><Check size={15}/>{busy ? "Recording…" : "Record evidence"}</button></footer>
  </section>;
}

function Metric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className="panel"><span className={`value-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}
function Evidence({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}
function decisionIcon(action: string) {
  if (action === "expand") return <TrendingUp size={15}/>;
  if (action === "correct") return <AlertTriangle size={15}/>;
  if (action === "retire") return <RotateCcw size={15}/>;
  return <BarChart3 size={15}/>;
}
function money(value: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function number(value: number, digits = 0) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(Number(value || 0)); }
function duration(value: number | null) {
  if (value === null || !Number.isFinite(Number(value))) return "No evidence";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}
function monthStart() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-01`; }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
