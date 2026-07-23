import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, BarChart3, CircleDollarSign, Clock3, Gauge, RefreshCw, RotateCcw, ShieldCheck, TrendingUp } from "lucide-react";
import { api, type ValueData } from "./api";
import "./value-portfolio.css";

export function ValuePortfolioView({ onNotice, onOpenProcess }: {
  onNotice: (message: string) => void; onOpenProcess: (id: string) => void;
}) {
  const [data, setData] = useState<ValueData | null>(null);
  const [filter, setFilter] = useState("all");
  async function load() {
    try { setData((await api.value()).data); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Value portfolio could not load"); }
  }
  useEffect(() => { void load(); }, []);
  const processes = useMemo(() => data?.portfolio.filter((item) =>
    filter === "all" || item.recommendation.action === filter) ?? [], [data, filter]);
  if (!data) return <div className="loading-card">Loading value evidence…</div>;
  const totals = data.totals ?? { items_processed: 0, human_minutes_saved: 0, estimated_value: 0, override_count: 0, failure_count: 0 };
  const actions = data.portfolio.reduce<Record<string, number>>((counts, item) => {
    counts[item.recommendation.action] = (counts[item.recommendation.action] ?? 0) + 1; return counts;
  }, {});
  return <section className="value-page">
    <div className="page-title"><div><span className="eyebrow"><TrendingUp size={14}/> EXECUTIVE VALUE PORTFOLIO</span>
      <h1>Value & decisions</h1><p>Measured business impact and transparent recommendations for where to expand, correct, observe, or retire.</p></div>
      <button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh evidence</button></div>
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
        <div className="portfolio-reason"><strong>Why this recommendation</strong><p>{item.recommendation.reason}.</p>
          <small>{item.recommendation.nextStep}</small></div>
        <footer><span>{item.status} · {item.operating_mode.replaceAll("_"," ")}
          {item.safety_autonomy_cap ? ` · safety cap ${item.safety_autonomy_cap}` : ""}</span>
          <button onClick={() => onOpenProcess(item.blueprint_id)}>Open Process Studio<ArrowRight size={14}/></button></footer>
      </article>)}
    </div>
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
