import { useEffect, useState } from "react";
import { BarChart3, CircleDollarSign, Gauge, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import { api, type SessionData, type UsageData } from "./api";

export function UsageView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(25);
  const [warning, setWarning] = useState(80);
  const [hardLimit, setHardLimit] = useState(false);
  async function load() {
    try { const result = (await api.usage()).data; setData(result); setLimit(result.budget?.monthly_limit_usd ?? 25); setWarning(result.budget?.warning_percent ?? 80); setHardLimit(Boolean(result.budget?.hard_limit)); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Usage ledger could not load"); }
  }
  useEffect(() => { void load(); }, []);
  async function save() { setSaving(true); try { await api.updateBudget({ monthlyLimitUsd: limit, warningPercent: warning, hardLimit }); await load(); onNotice("Monthly AI budget policy saved and audited."); } catch (error) { onNotice(error instanceof Error ? error.message : "Budget could not be saved"); } finally { setSaving(false); } }
  if (!data) return <div className="loading-card">Loading usage ledger…</div>;
  const spent = Number(data.summary.estimated_cost_usd || 0);
  const budget = Number(data.budget?.monthly_limit_usd ?? limit);
  const percent = budget > 0 ? Math.min(100, spent / budget * 100) : 0;
  return <section className="usage-page"><div className="page-title"><div><span className="eyebrow"><CircleDollarSign size={14}/> AI COST GOVERNANCE</span><h1>Usage & budgets</h1><p>Explainable Workers AI consumption by process, model, and execution.</p></div><button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh</button></div>
    <div className="usage-metrics"><article className="panel"><span className="metric-icon green"><CircleDollarSign size={18}/></span><div><small>ESTIMATED THIS MONTH</small><strong>{money(spent)}</strong><p>{percent.toFixed(1)}% of {money(budget)} budget</p></div></article><article className="panel"><span className="metric-icon blue"><Zap size={18}/></span><div><small>MODEL TOKENS</small><strong>{number(data.summary.total_tokens)}</strong><p>{number(data.summary.input_tokens)} in · {number(data.summary.output_tokens)} out</p></div></article><article className="panel"><span className="metric-icon violet"><BarChart3 size={18}/></span><div><small>AI RUNS</small><strong>{number(data.summary.executions + data.summary.evaluation_cases)}</strong><p>{number(data.summary.executions)} operations · {number(data.summary.evaluation_cases)} evaluation cases</p></div></article></div>
    <div className="budget-panel panel"><div><span><Gauge size={18}/><strong>Monthly budget consumption</strong></span><div className="budget-track"><i style={{ width: `${percent}%` }}/></div><small>{money(spent)} estimated of {money(budget)}</small></div><label>Budget USD<input type="number" min="1" max="1000000" value={limit} onChange={(e) => setLimit(Number(e.target.value))}/></label><label>Warn at %<input type="number" min="1" max="100" value={warning} onChange={(e) => setWarning(Number(e.target.value))}/></label><label className="hard-limit"><input type="checkbox" checked={hardLimit} onChange={(e) => setHardLimit(e.target.checked)}/><span><strong>Hard limit</strong><small>Reject new AI executions at budget</small></span></label><button className="primary" disabled={saving || !["admin","owner"].includes(session?.user.role ?? "")} onClick={() => void save()}>{saving ? "Saving…" : "Save policy"}</button></div>
    <div className="usage-layout"><article className="usage-table panel"><div className="section-head"><div><h2>Cost by process</h2><p>Estimated from captured input/output tokens.</p></div></div><div className="usage-head"><span>Process</span><span>Runs</span><span>Tokens</span><span>Estimated</span></div>{data.byProcess.map((item) => <div className="usage-row" key={item.blueprint_id}><strong>{item.process_name}</strong><span>{number(item.executions)}</span><span>{number(item.total_tokens)}</span><strong>{money(item.estimated_cost_usd)}</strong></div>)}</article>
      <aside className="model-rates panel"><div className="section-head"><div><h2>Cloudflare model rates</h2><p>Price snapshot used by this ledger.</p></div></div>{data.models.map((model) => <div className="model-rate" key={model.model_id}><span><strong>{model.label}</strong><small>{model.model_id}</small></span><span><strong>${model.input_usd_per_million}/M in</strong><small>${model.output_usd_per_million}/M out · {number(model.context_tokens)} context</small></span></div>)}</aside></div>
    <div className="estimate-notice"><ShieldAlert size={16}/>{data.estimateNotice}</div>
  </section>;
}
function money(value: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(Number(value || 0)); }
function number(value: number) { return new Intl.NumberFormat().format(Number(value || 0)); }
