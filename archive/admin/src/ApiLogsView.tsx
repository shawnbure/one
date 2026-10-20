import { useEffect, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Clock3, Code2, Copy, RefreshCw, Search } from "lucide-react";
import { api, type ApiLog, type ApiLogPage } from "./api";

const emptyPage: ApiLogPage = {
  data: [],
  page: { limit: 50, hasMore: false, nextCursor: null },
  summary: { total: 0, averageLatencyMs: 0, errors: 0 }
};

export function ApiLogsView({ onNotice }: { onNotice: (message: string) => void }) {
  const [result, setResult] = useState<ApiLogPage>(emptyPage);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [direction, setDirection] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(reset = true) {
    setBusy(true);
    try {
      const next = await api.logs({
        direction, outcome, search: appliedSearch,
        cursor: reset ? undefined : result.page.nextCursor ?? undefined
      });
      setResult(reset ? next : { ...next, data: [...result.data, ...next.data] });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load API logs");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(true); }, [direction, outcome, appliedSearch]);

  return <section className="api-logs-page">
    <div className="page-title"><div><span className="eyebrow"><Code2 size={14}/> INTEGRATION OBSERVABILITY</span>
      <h1>API Logs</h1><p>Tenant-scoped request evidence without sensitive request or response bodies.</p></div>
      <button className="refresh-button" disabled={busy} onClick={() => void load(true)}>
        <RefreshCw size={15}/>{busy ? "Loading…" : "Refresh"}
      </button>
    </div>
    <div className="activity-metrics">
      <article><span className="metric-icon blue"><Activity size={18}/></span><div>
        <small>MATCHING REQUESTS</small><strong>{result.summary.total.toLocaleString()}</strong></div></article>
      <article><span className="metric-icon amber"><Clock3 size={18}/></span><div>
        <small>AVERAGE LATENCY</small><strong>{result.summary.averageLatencyMs.toLocaleString()}ms</strong></div></article>
      <article><span className="metric-icon violet"><Code2 size={18}/></span><div>
        <small>MATCHING ERRORS</small><strong>{result.summary.errors.toLocaleString()}</strong></div></article>
    </div>
    <form className="activity-toolbar api-log-toolbar" onSubmit={(event) => {
      event.preventDefault(); setAppliedSearch(search.trim());
    }}>
      <div><Search size={16}/><input maxLength={100} aria-label="Search API logs"
        placeholder="Search method, path, actor, or trace ID" value={search}
        onChange={(event) => setSearch(event.target.value)}/></div>
      <select aria-label="Filter API log direction" value={direction}
        onChange={(event) => setDirection(event.target.value)}>
        <option value="">All directions</option><option value="inbound">Inbound</option>
        <option value="outbound">Outbound</option>
      </select>
      <select aria-label="Filter API log outcome" value={outcome}
        onChange={(event) => setOutcome(event.target.value)}>
        <option value="">All outcomes</option><option value="success">Success</option><option value="error">Errors</option>
      </select>
      <button type="submit" disabled={busy}>Apply</button>
    </form>
    <p className="api-log-window">Showing {result.data.length.toLocaleString()} of{" "}
      {result.summary.total.toLocaleString()} matching retained records. API-log retention is controlled in Governance.</p>
    <div className="api-table panel">
      <div className="api-head"><span>Direction</span><span>Request</span><span>Status</span>
        <span>Latency</span><span>Actor</span><span>Trace</span><span>Time</span></div>
      {result.data.map((log) => <LogRow log={log} onNotice={onNotice} key={log.id}/>)}
      {!busy && !result.data.length && <p className="api-log-empty">No retained API logs match these filters.</p>}
      {result.page.hasMore && <div className="api-log-more"><button disabled={busy}
        onClick={() => void load(false)}>{busy ? "Loading…" : "Load 50 more"}</button></div>}
    </div>
  </section>;
}

function LogRow({ log, onNotice }: { log: ApiLog; onNotice: (message: string) => void }) {
  return <div className="api-row">
    <span className={log.direction}>{log.direction === "inbound"
      ? <ArrowDownLeft size={14}/> : <ArrowUpRight size={14}/>} {log.direction}</span>
    <span><strong>{log.method}</strong>{log.path}</span>
    <span className={log.status >= 400 ? "http-error" : "http-ok"}>{log.status}</span>
    <span>{log.duration_ms.toLocaleString()}ms</span><span>{log.actor_id ?? "system"}</span>
    <button title="Copy trace ID" onClick={() => {
      void navigator.clipboard.writeText(log.trace_id); onNotice("Trace ID copied.");
    }}><Copy size={13}/>{log.trace_id.slice(0, 10)}</button><span>{formatDate(log.created_at)}</span>
  </div>;
}

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit"
  }).format(date);
}
