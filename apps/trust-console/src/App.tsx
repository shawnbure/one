import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Boxes,
  Briefcase,
  CircleDollarSign,
  Gavel,
  KeyRound,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError, type Auth } from "./api";

type View = "overview" | "capabilities" | "jobs" | "approvals" | "disputes" | "ledger";
const NAV: { id: View; label: string; icon: typeof Boxes }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "capabilities", label: "Capabilities", icon: Boxes },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "disputes", label: "Disputes", icon: Gavel },
  { id: "ledger", label: "Ledger", icon: Receipt },
];

const STATE_TONE: Record<string, string> = {
  open: "slate", quoted: "slate", accepted: "amber", delivered: "blue",
  settled: "green", refunded: "red", disputed: "red", cancelled: "slate",
};

function useLocal(key: string, initial: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem(key) ?? initial; } catch { return initial; }
  });
  const set = (nv: string) => {
    setV(nv);
    try { localStorage.setItem(key, nv); } catch { /* ignore */ }
  };
  return [v, set];
}

export function App() {
  const [base, setBase] = useLocal("wxp.base", "");
  const [token, setToken] = useLocal("wxp.token", "");
  const [view, setView] = useState<View>("overview");
  const auth: Auth = { base, token };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="mark">✳</span> Trust Console</div>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="auth">
          <label><KeyRound size={13} /> Connection</label>
          <input placeholder="Base URL (blank = same origin)" value={base} onChange={(e) => setBase(e.target.value)} />
          <input placeholder="Bearer token (moderator/operator)" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <p className="hint">Moderator token enables approvals, disputes and any-ledger views.</p>
        </div>
      </aside>
      <main className="content">
        {view === "overview" && <Overview auth={auth} />}
        {view === "capabilities" && <Capabilities auth={auth} />}
        {view === "jobs" && <Jobs auth={auth} />}
        {view === "approvals" && <Approvals auth={auth} />}
        {view === "disputes" && <Disputes auth={auth} />}
        {view === "ledger" && <Ledger auth={auth} />}
      </main>
    </div>
  );
}

/** Poll a loader every 5s; expose data, error and a manual refresh. */
function usePoll<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await load()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    const t = setInterval(run, 5000);
    return () => clearInterval(t);
  }, [run]);
  return { data, error, loading, refresh: run };
}

function Panel({ title, refresh, loading, error, children }: { title: string; refresh?: () => void; loading?: boolean; error?: string | null; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h1>{title}</h1>
        {refresh && <button className="ghost" onClick={refresh}><RefreshCw size={14} className={loading ? "spin" : ""} /></button>}
      </header>
      {error && <div className="error">{error}</div>}
      {children}
    </section>
  );
}

function Pill({ state }: { state: string }) {
  return <span className={`pill ${STATE_TONE[state] || "slate"}`}>{state}</span>;
}

function Overview({ auth }: { auth: Auth }) {
  const { data, error, loading, refresh } = usePoll(() => api.discovery(auth), [auth.base, auth.token]);
  const ex = data?.exchange;
  return (
    <Panel title="Exchange overview" refresh={refresh} loading={loading} error={error}>
      {ex ? (
        <div className="grid">
          <Stat label="Credit unit" value={ex.unit?.code} sub={ex.unit?.peg} />
          <Stat label="Take rate" value={`${(ex.takeRate?.providerBps ?? 0) / 100}%`} sub={`floor ${ex.takeRate?.floorWxc} · cap ${ex.takeRate?.capWxc} WXC`} />
          <Stat label="Protocol" value={ex.version} sub="WXP" />
          <Stat label="MCP" value="enabled" sub={ex.mcp} />
          <div className="card wide">
            <div className="k">Ledger public key</div>
            <code className="mono">{ex.ledgerPublicKey || "(per-isolate dev key)"}</code>
          </div>
        </div>
      ) : (
        <p className="muted">Connect to a Workrr Exchange node to begin.</p>
      )}
    </Panel>
  );
}

function Stat({ label, value, sub }: { label: string; value?: string; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{label}</div>
      <div className="v">{value ?? "—"}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Capabilities({ auth }: { auth: Auth }) {
  const { data, error, loading, refresh } = usePoll(() => api.capabilities(auth), [auth.base, auth.token]);
  const caps = data?.capabilities ?? [];
  return (
    <Panel title="Capabilities" refresh={refresh} loading={loading} error={error}>
      <table>
        <thead><tr><th>Name</th><th>Provider</th><th>Price</th><th>Verify</th><th>Tags</th></tr></thead>
        <tbody>
          {caps.map((c: any) => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><div className="sub">{c.summary}</div></td>
              <td className="mono">{c.agent}</td>
              <td>{c.pricing?.amount} {c.pricing?.currency}</td>
              <td>{c.verification?.mode}</td>
              <td>{(c.tags || []).map((t: string) => <span key={t} className="tag">{t}</span>)}</td>
            </tr>
          ))}
          {!caps.length && <tr><td colSpan={5} className="muted">No capabilities published.</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function Jobs({ auth }: { auth: Auth }) {
  const { data, error, loading, refresh } = usePoll(() => api.jobs(auth), [auth.base, auth.token]);
  const jobs = data?.jobs ?? [];
  return (
    <Panel title="Jobs" refresh={refresh} loading={loading} error={error}>
      <table>
        <thead><tr><th>Job</th><th>State</th><th>Price</th><th>Requester</th><th>Provider</th><th>Verifier</th></tr></thead>
        <tbody>
          {jobs.map((j: any) => (
            <tr key={j.id}>
              <td className="mono">{j.id.slice(0, 14)}…</td>
              <td><Pill state={j.state} /></td>
              <td>{j.price ?? "—"}</td>
              <td className="mono">{j.requester}</td>
              <td className="mono">{j.provider ?? "—"}</td>
              <td>{j.verifier?.mode ?? "—"}</td>
            </tr>
          ))}
          {!jobs.length && <tr><td colSpan={6} className="muted">No jobs yet (moderator token required for all jobs).</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function Approvals({ auth }: { auth: Auth }) {
  const { data, error, loading, refresh } = usePoll(() => api.approvals(auth), [auth.base, auth.token]);
  const approvals = data?.approvals ?? [];
  return (
    <Panel title="Pending approvals" refresh={refresh} loading={loading} error={error}>
      <p className="muted small">Over-threshold jobs waiting for a human. Deciding requires the requester's signed key (via the API); this view surfaces the queue.</p>
      <table>
        <thead><tr><th>Approval</th><th>Job</th><th>Kind</th><th>Amount</th><th>Opened</th></tr></thead>
        <tbody>
          {approvals.map((a: any) => (
            <tr key={a.id}>
              <td className="mono">{a.id.slice(0, 12)}…</td>
              <td className="mono">{a.job.slice(0, 12)}…</td>
              <td>{a.kind}</td>
              <td>{a.amount ?? "—"} WXC</td>
              <td className="sub">{new Date(a.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {!approvals.length && <tr><td colSpan={5} className="muted">No pending approvals.</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function Disputes({ auth }: { auth: Auth }) {
  const { data, error, loading, refresh } = usePoll(() => api.disputes(auth), [auth.base, auth.token]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const disputes = data?.disputes ?? [];

  const rule = async (id: string, decision: string, providerBps?: number) => {
    setBusy(id); setMsg(null);
    try { await api.resolveDispute(auth, id, decision, providerBps); setMsg(`Resolved ${id.slice(0, 10)}… as ${decision}`); refresh(); }
    catch (e) { setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <Panel title="Open disputes" refresh={refresh} loading={loading} error={error}>
      {msg && <div className="notice">{msg}</div>}
      <table>
        <thead><tr><th>Dispute</th><th>Job</th><th>Tier</th><th>Opener</th><th>Reason</th><th>Ruling</th></tr></thead>
        <tbody>
          {disputes.map((d: any) => (
            <tr key={d.id}>
              <td className="mono">{d.id.slice(0, 12)}…</td>
              <td className="mono">{d.job.slice(0, 12)}…</td>
              <td>T{d.tier}</td>
              <td className="mono">{d.opener}</td>
              <td className="sub">{d.reason}</td>
              <td className="actions">
                <button disabled={busy === d.id} onClick={() => rule(d.id, "full_release")}>Release</button>
                <button disabled={busy === d.id} onClick={() => rule(d.id, "full_refund")}>Refund</button>
                <button disabled={busy === d.id} onClick={() => rule(d.id, "split", 5000)}>Split 50/50</button>
              </td>
            </tr>
          ))}
          {!disputes.length && <tr><td colSpan={6} className="muted">No open disputes (moderator token required).</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function Ledger({ auth }: { auth: Auth }) {
  const [owner, setOwner] = useLocal("wxp.ledgerOwner", "platform");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.ledger(auth, owner)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e)); }
  }, [auth.base, auth.token, owner]);
  useEffect(() => { load(); }, [load]);

  return (
    <Panel title="Ledger" error={error} refresh={load}>
      <div className="row">
        <input placeholder="Operator id (or 'platform')" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <button onClick={load}>Load</button>
      </div>
      {data && (
        <>
          <div className="grid">
            {Object.entries(data.balances || {}).map(([type, bal]) => (
              <Stat key={type} label={type} value={`${bal} WXC`} />
            ))}
          </div>
          <table>
            <thead><tr><th>When</th><th>Account</th><th>Dir</th><th>Amount</th><th>Memo</th><th>Sig</th></tr></thead>
            <tbody>
              {(data.entries || []).map((e: any) => (
                <tr key={e.id}>
                  <td className="sub">{new Date(e.at).toLocaleTimeString()}</td>
                  <td>{e.accountType}</td>
                  <td><span className={`pill ${e.direction === "credit" ? "green" : "amber"}`}>{e.direction}</span></td>
                  <td>{e.amount}</td>
                  <td className="sub">{e.memo}</td>
                  <td><CircleDollarSign size={13} className="muted" aria-label={e.sig ? "signed" : "unsigned"} /></td>
                </tr>
              ))}
              {!data.entries?.length && <tr><td colSpan={6} className="muted">No ledger entries.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
}
