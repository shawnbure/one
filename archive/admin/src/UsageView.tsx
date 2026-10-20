import { useEffect, useState } from "react";
import { BarChart3, CircleDollarSign, FileUp, Gauge, RefreshCw, Scale, ShieldAlert, Zap } from "lucide-react";
import { api, type SessionData, type UsageData } from "./api";
import "./process-budgets.css";

export function UsageView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(25);
  const [warning, setWarning] = useState(80);
  const [hardLimit, setHardLimit] = useState(false);
  const [processBudget, setProcessBudget] = useState({
    blueprintId: "", enabled: false, monthlyLimitUsd: 5, warningPercent: 80, hardLimit: false
  });
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [billing, setBilling] = useState(() => ({
    periodStart: monthStart(), periodEnd: today(), source: "cloudflare_dashboard",
    sourceReference: "", workersAiNeurons: "", workersAiCostUsd: "", platformCostUsd: "",
    workersRequests: "", d1RowsRead: "", d1RowsWritten: "", queueOperations: "", workflowWallTimeMs: ""
  }));
  async function load() {
    try {
      const result = (await api.usage()).data;
      setData(result); setLimit(result.budget?.monthly_limit_usd ?? 25);
      setWarning(result.budget?.warning_percent ?? 80); setHardLimit(Boolean(result.budget?.hard_limit));
      const selected = result.byProcess.find((item) => item.blueprint_id === processBudget.blueprintId) ?? result.byProcess[0];
      if (selected) selectProcessBudget(selected);
    }
    catch (error) { onNotice(error instanceof Error ? error.message : "Usage ledger could not load"); }
  }
  useEffect(() => { void load(); }, []);
  async function save() { setSaving(true); try { await api.updateBudget({ monthlyLimitUsd: limit, warningPercent: warning, hardLimit }); await load(); onNotice("Monthly AI budget policy saved and audited."); } catch (error) { onNotice(error instanceof Error ? error.message : "Budget could not be saved"); } finally { setSaving(false); } }
  function selectProcessBudget(item: UsageData["byProcess"][number]) {
    setProcessBudget({
      blueprintId: item.blueprint_id, enabled: item.monthly_limit_usd !== null,
      monthlyLimitUsd: Number(item.monthly_limit_usd ?? 5),
      warningPercent: Number(item.warning_percent ?? 80), hardLimit: Boolean(item.hard_limit)
    });
  }
  async function saveProcessBudget() {
    if (!processBudget.blueprintId) return;
    setSaving(true);
    try {
      await api.updateProcessBudget(processBudget.blueprintId, processBudget);
      await load();
      onNotice(processBudget.enabled
        ? "Process AI budget saved and enforced across Agents, Workflows, and evaluations."
        : "Process-specific budget removed; the organization budget still applies.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Process budget could not be saved"); }
    finally { setSaving(false); }
  }
  async function reconcile() {
    setReconcileBusy(true);
    try {
      const result = await api.importBillingEvidence({
        periodStart: billing.periodStart, periodEnd: billing.periodEnd, source: billing.source,
        sourceReference: billing.sourceReference, workersAiCostUsd: Number(billing.workersAiCostUsd),
        workersAiNeurons: optional(billing.workersAiNeurons), platformCostUsd: optional(billing.platformCostUsd),
        workersRequests: optional(billing.workersRequests), d1RowsRead: optional(billing.d1RowsRead),
        d1RowsWritten: optional(billing.d1RowsWritten), queueOperations: optional(billing.queueOperations),
        workflowWallTimeMs: optional(billing.workflowWallTimeMs)
      });
      setBilling({ ...billing, sourceReference: "", workersAiNeurons: "", workersAiCostUsd: "",
        platformCostUsd: "", workersRequests: "", d1RowsRead: "", d1RowsWritten: "",
        queueOperations: "", workflowWallTimeMs: "" });
      await load();
      onNotice(result.data.imported ? "Cloudflare billing evidence reconciled and audited." : "That billing evidence was already imported.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Billing evidence could not be imported"); }
    finally { setReconcileBusy(false); }
  }
  async function voidEvidence(id: string) {
    setReconcileBusy(true);
    try {
      await api.voidBillingEvidence(id, voidReason);
      setVoiding(null); setVoidReason(""); await load();
      onNotice("Billing evidence voided; the original record remains in the audit trail.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Billing evidence could not be voided"); }
    finally { setReconcileBusy(false); }
  }
  if (!data) return <div className="loading-card">Loading usage ledger…</div>;
  const spent = Number(data.summary.estimated_cost_usd || 0);
  const budget = Number(data.budget?.monthly_limit_usd ?? limit);
  const percent = budget > 0 ? Math.min(100, spent / budget * 100) : 0;
  const canManage = ["admin", "owner"].includes(session?.user.role ?? "");
  const latest = data.reconciliations.find((item) => item.status === "active");
  return <section className="usage-page"><div className="page-title"><div><span className="eyebrow"><CircleDollarSign size={14}/> AI COST GOVERNANCE</span><h1>Usage & Budgets</h1><p>Explainable Workers AI consumption by process, model, and execution.</p></div><button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh</button></div>
    <div className="usage-metrics"><article className="panel"><span className="metric-icon green"><CircleDollarSign size={18}/></span><div><small>ESTIMATED THIS MONTH</small><strong>{money(spent)}</strong><p>{percent.toFixed(1)}% of {money(budget)} budget</p></div></article><article className="panel"><span className="metric-icon blue"><Zap size={18}/></span><div><small>MODEL TOKENS</small><strong>{number(data.summary.total_tokens)}</strong><p>{number(data.summary.input_tokens)} in · {number(data.summary.output_tokens)} out</p></div></article><article className="panel"><span className="metric-icon violet"><BarChart3 size={18}/></span><div><small>AI RUNS</small><strong>{number(data.summary.executions + data.summary.evaluation_cases)}</strong><p>{number(data.summary.executions)} operations · {number(data.summary.evaluation_cases)} evaluation cases</p></div></article></div>
    <div className="budget-panel panel"><div><span><Gauge size={18}/><strong>Monthly budget consumption</strong></span><div className="budget-track"><i style={{ width: `${percent}%` }}/></div><small>{money(spent)} estimated of {money(budget)}</small></div><label>Budget USD<input type="number" min="1" max="1000000" value={limit} onChange={(e) => setLimit(Number(e.target.value))}/></label><label>Warn at %<input type="number" min="1" max="100" value={warning} onChange={(e) => setWarning(Number(e.target.value))}/></label><label className="hard-limit"><input type="checkbox" checked={hardLimit} onChange={(e) => setHardLimit(e.target.checked)}/><span><strong>Hard limit</strong><small>Reject new AI executions at budget</small></span></label><button className="primary" disabled={saving || !["admin","owner"].includes(session?.user.role ?? "")} onClick={() => void save()}>{saving ? "Saving…" : "Save policy"}</button></div>
    <article className="process-budget-panel panel"><div className="section-head"><div><h2>Process allocation guardrail</h2>
      <p>Contain one noisy process without stopping every other approved use case.</p></div></div>
      <div className="process-budget-fields">
        <label>AI process<select value={processBudget.blueprintId} onChange={(event) => {
          const item = data.byProcess.find((candidate) => candidate.blueprint_id === event.target.value);
          if (item) selectProcessBudget(item);
        }}>{data.byProcess.map((item) => <option key={item.blueprint_id} value={item.blueprint_id}>{item.process_name}</option>)}</select></label>
        <label className="hard-limit"><input type="checkbox" checked={processBudget.enabled}
          onChange={(event) => setProcessBudget({ ...processBudget, enabled: event.target.checked })}/>
          <span><strong>Use process budget</strong><small>Organization budget always remains authoritative</small></span></label>
        <label>Monthly USD<input type="number" min="0.01" max="1000000" step="0.01"
          disabled={!processBudget.enabled} value={processBudget.monthlyLimitUsd}
          onChange={(event) => setProcessBudget({ ...processBudget, monthlyLimitUsd: Number(event.target.value) })}/></label>
        <label>Warn at %<input type="number" min="1" max="100" disabled={!processBudget.enabled}
          value={processBudget.warningPercent}
          onChange={(event) => setProcessBudget({ ...processBudget, warningPercent: Number(event.target.value) })}/></label>
        <label className="hard-limit"><input type="checkbox" checked={processBudget.hardLimit}
          disabled={!processBudget.enabled}
          onChange={(event) => setProcessBudget({ ...processBudget, hardLimit: event.target.checked })}/>
          <span><strong>Hard limit</strong><small>Reject new model calls for this process</small></span></label>
        <button className="primary" disabled={saving || !canManage || !processBudget.blueprintId}
          onClick={() => void saveProcessBudget()}>{saving ? "Saving…" : "Save allocation"}</button>
      </div>
      {processBudget.blueprintId && <p className="process-budget-boundary">Enforcement uses captured month-to-date execution and evaluation cost. Delayed Workflows recheck immediately before inference; parallel in-flight calls may settle just beyond the boundary.</p>}
    </article>
    <div className="usage-layout"><article className="usage-table panel"><div className="section-head"><div><h2>Cost by process</h2><p>Estimated from captured input/output tokens.</p></div></div><div className="usage-head"><span>Process</span><span>Runs</span><span>Tokens</span><span>Estimated</span></div>{data.byProcess.map((item) => {
      const processPercent = Number(item.monthly_limit_usd) > 0
        ? Number(item.estimated_cost_usd) / Number(item.monthly_limit_usd) * 100 : 0;
      const warned = item.warning_percent !== null && processPercent >= Number(item.warning_percent);
      return <div className="usage-row" key={item.blueprint_id}><strong>{item.process_name}{item.monthly_limit_usd !== null &&
        <small className={warned ? "allocation-warning" : ""}>{money(item.estimated_cost_usd)} of {money(item.monthly_limit_usd)} · {warned ? "warning reached" : item.hard_limit ? "hard stop enabled" : "warning only"}</small>}</strong><span>{number(item.executions)}</span><span>{number(item.total_tokens)}</span><strong>{money(item.estimated_cost_usd)}</strong></div>;
    })}</article>
      <aside className="model-rates panel"><div className="section-head"><div><h2>Cloudflare model rates</h2><p>Price snapshot used by this ledger.</p></div></div>{data.models.map((model) => <div className="model-rate" key={model.model_id}><span><strong>{model.label}</strong><small>{model.model_id}</small></span><span><strong>${model.input_usd_per_million}/M in</strong><small>${model.output_usd_per_million}/M out · {number(model.context_tokens)} context</small></span></div>)}</aside></div>
    <article className="billing-reconciliation panel">
      <div className="section-head"><div><span className="eyebrow"><Scale size={14}/> VERIFIED COST EVIDENCE</span><h2>Cloudflare reconciliation</h2><p>Compare Workrr estimates with normalized dashboard, invoice, or API totals.</p></div>
        {latest && <span className={`variance-badge ${latest.variance_percent !== null &&
          Math.abs(Number(latest.variance_percent)) <= 10 ? "matched" : "review"}`}>
          {latest.variance_percent === null ? "No estimate baseline" : `${signedPercent(latest.variance_percent)} variance`}</span>}</div>
      <div className="reconciliation-layout">
        <div className="billing-import">
          <div className="billing-fields">
            <label>Period start<input type="date" value={billing.periodStart} disabled={!canManage || reconcileBusy}
              onChange={(event) => setBilling({ ...billing, periodStart: event.target.value })}/></label>
            <label>Period end<input type="date" value={billing.periodEnd} disabled={!canManage || reconcileBusy}
              onChange={(event) => setBilling({ ...billing, periodEnd: event.target.value })}/></label>
            <label>Evidence source<select value={billing.source} disabled={!canManage || reconcileBusy}
              onChange={(event) => setBilling({ ...billing, source: event.target.value })}>
              <option value="cloudflare_dashboard">Cloudflare dashboard</option><option value="cloudflare_invoice">Cloudflare invoice</option>
              <option value="cloudflare_api">Cloudflare billing API</option><option value="other">Other verified evidence</option>
            </select></label>
            <label>Source reference<input placeholder="Invoice, export, or evidence ID" value={billing.sourceReference}
              disabled={!canManage || reconcileBusy} onChange={(event) => setBilling({ ...billing, sourceReference: event.target.value })}/></label>
            <label>Workers AI billed USD<input type="number" min="0" step="0.0001" value={billing.workersAiCostUsd}
              disabled={!canManage || reconcileBusy} onChange={(event) => setBilling({ ...billing, workersAiCostUsd: event.target.value })}/></label>
            <label>Workers AI neurons<input type="number" min="0" step="1" value={billing.workersAiNeurons}
              disabled={!canManage || reconcileBusy} onChange={(event) => setBilling({ ...billing, workersAiNeurons: event.target.value })}/></label>
            <label>Total platform USD<input type="number" min="0" step="0.01" value={billing.platformCostUsd}
              disabled={!canManage || reconcileBusy} onChange={(event) => setBilling({ ...billing, platformCostUsd: event.target.value })}/></label>
            <label>Worker requests<input type="number" min="0" step="1" value={billing.workersRequests}
              disabled={!canManage || reconcileBusy} onChange={(event) => setBilling({ ...billing, workersRequests: event.target.value })}/></label>
          </div>
          <details><summary>Optional platform counters</summary><div className="billing-fields optional">
            {([["d1RowsRead","D1 rows read"],["d1RowsWritten","D1 rows written"],["queueOperations","Queue operations"],
              ["workflowWallTimeMs","Workflow wall time ms"]] as const).map(([field,label]) =>
              <label key={field}>{label}<input type="number" min="0" step="1" value={billing[field]}
                disabled={!canManage || reconcileBusy} onChange={(event) => setBilling({ ...billing, [field]: event.target.value })}/></label>)}
          </div></details>
          <button className="primary" disabled={!canManage || reconcileBusy || billing.sourceReference.trim().length < 3 ||
            billing.workersAiCostUsd === ""} onClick={() => void reconcile()}><FileUp size={15}/>
            {reconcileBusy ? "Importing…" : "Import billing evidence"}</button>
          <p className="billing-boundary">Workrr stores normalized totals and a checksum—not invoice files, credentials, or arbitrary billing payloads. Native Workers AI and AI Gateway charges remain separate evidence sources.</p>
        </div>
        <div className="reconciliation-history">
          <div className="reconciliation-head"><span>Period / source</span><span>Workrr estimate</span><span>AI billed</span><span>Variance</span><span>Status</span></div>
          {data.reconciliations.length ? data.reconciliations.map((item) => <div className={`reconciliation-row ${item.status}`} key={item.id}>
            <span><strong>{item.period_start} – {item.period_end}</strong><small>{item.source.replaceAll("_"," ")} · {item.source_reference}</small></span>
            <span>{money(item.workrr_estimated_ai_cost_usd)}</span><span>{money(item.workers_ai_cost_usd)}</span>
            <strong className={Math.abs(Number(item.variance_percent ?? 0)) <= 10 ? "matched" : "review"}>{signedMoney(item.variance_usd)}<small>{signedPercent(item.variance_percent)}</small></strong>
            <span><em>{item.status}</em>{canManage && item.status === "active" && (voiding === item.id
              ? <span className="void-controls"><input placeholder="Correction reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)}/>
                <button disabled={voidReason.trim().length < 10 || reconcileBusy} onClick={() => void voidEvidence(item.id)}>Confirm void</button>
                <button onClick={() => { setVoiding(null); setVoidReason(""); }}>Cancel</button></span>
              : <button onClick={() => setVoiding(item.id)}>Void</button>)}</span>
          </div>) : <p className="empty-copy">No Cloudflare billing evidence imported yet.</p>}
        </div>
      </div>
    </article>
    <div className="estimate-notice"><ShieldAlert size={16}/>{data.estimateNotice}</div>
  </section>;
}
function money(value: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(Number(value || 0)); }
function number(value: number) { return new Intl.NumberFormat().format(Number(value || 0)); }
function optional(value: string) { return value === "" ? null : Number(value); }
function monthStart() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-01`; }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function signedMoney(value: number) { const amount = Number(value || 0); return `${amount > 0 ? "+" : ""}${money(amount)}`; }
function signedPercent(value: number | null) { if (value === null) return "baseline unavailable"; const amount = Number(value); return `${amount > 0 ? "+" : ""}${amount.toFixed(1)}%`; }
