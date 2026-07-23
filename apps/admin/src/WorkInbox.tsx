import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Clock3, FileText, Inbox, ShieldCheck, UserRound, X } from "lucide-react";
import { api, type Approval, type ApprovalDetail, type AuditEvent, type SessionData } from "./api";

interface Props {
  items: Approval[];
  session: SessionData | null;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
}

export function WorkInbox({ items, session, onRefresh, onNotice }: Props) {
  const [filter, setFilter] = useState<"pending" | "resolved" | "all">("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => items.filter((item) => filter === "all" || (filter === "pending" ? item.status === "pending" : item.status !== "pending")), [items, filter]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setAudit([]); return; }
    void api.approval(selectedId).then((result) => { setDetail(result.data); setAudit(result.audit); }).catch((error: Error) => onNotice(error.message));
  }, [selectedId]);

  async function decide(decision: "approved" | "rejected") {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.decideApproval(detail.id, decision, note.trim() || undefined);
      if (!result.updated) throw new Error("This item was already resolved by another reviewer.");
      onNotice(decision === "approved" ? "Action approved. The decision is now in the audit history." : "Action declined. The process owner can revise and resubmit it.");
      setSelectedId(null); setNote(""); await onRefresh();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Decision failed"); }
    finally { setBusy(false); }
  }

  if (selectedId) return <section className="inbox-page detail-page">
    <button className="back-link" onClick={() => setSelectedId(null)}><ArrowLeft size={15}/>Back to work inbox</button>
    {!detail ? <div className="loading-card">Loading review evidence…</div> : <div className="review-layout">
      <article className="review-main panel">
        <div className="review-heading"><span className="review-icon"><FileText size={20}/></span><div><span className={`status ${detail.status}`}><span/>{detail.status}</span><h1>{detail.title ?? detail.action_name.replaceAll("_", " ")}</h1><p>{detail.description ?? "An AI process has requested a human decision."}</p></div></div>
        <div className="evidence-block"><label>SOURCE REQUEST</label><p>{detail.input_preview}</p></div>
        <div className="evidence-block proposed"><label>PROPOSED OUTPUT</label><p>{detail.output_preview ?? "The process did not attach an output preview."}</p></div>
        <div className="decision-context"><span><ShieldCheck size={17}/><div><strong>{detail.impact} impact</strong><small>Human authorization required by process policy</small></div></span><span><UserRound size={17}/><div><strong>{detail.assigned_to ?? "Unassigned"}</strong><small>Assigned reviewer</small></div></span></div>
        {detail.status === "pending" && <div className="decision-box"><label htmlFor="decision-note">Decision rationale <em>optional</em></label><textarea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for the process owner and audit record…"/><div><button disabled={busy} onClick={() => void decide("rejected")}><X size={16}/>Decline</button><button disabled={busy} className="approve" onClick={() => void decide("approved")}><Check size={16}/>{busy ? "Recording…" : "Approve action"}</button></div></div>}
      </article>
      <aside className="review-side panel"><h2>Decision record</h2><dl><div><dt>Process</dt><dd>{detail.blueprint_id.replaceAll("-", " ")}</dd></div><div><dt>Requested</dt><dd>{formatDate(detail.requested_at)}</dd></div><div><dt>Due</dt><dd>{detail.due_at ? formatDate(detail.due_at) : "No deadline"}</dd></div><div><dt>Model</dt><dd>{detail.model?.split("/").at(-1) ?? "Not recorded"}</dd></div></dl><h3>Audit timeline</h3><div className="audit-line"><span><i/><strong>Approval requested</strong><small>{formatDate(detail.requested_at)}</small></span>{audit.map((event) => <span key={`${event.event_type}-${event.created_at}`}><i/><strong>{event.event_type.replaceAll(".", " ")}</strong><small>{formatDate(event.created_at)} · {event.actor_id}</small></span>)}</div></aside>
    </div>}
  </section>;

  return <section className="inbox-page">
    <div className="page-title"><div><span className="eyebrow"><Inbox size={14}/> HUMAN CONTROL</span><h1>Work inbox</h1><p>Review consequential actions with the evidence and context needed to decide safely.</p></div><div className="assignment-chip"><UserRound size={15}/><span><small>VIEWING AS</small><strong>{session?.user.name ?? "Authorized reviewer"}</strong></span></div></div>
    <div className="inbox-tabs">{(["pending", "resolved", "all"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{value === "pending" ? items.filter((item) => item.status === "pending").length : value === "resolved" ? items.filter((item) => item.status !== "pending").length : items.length}</span></button>)}</div>
    <div className="work-list panel">{filtered.length ? filtered.map((item) => <button key={item.id} className="work-row" onClick={() => setSelectedId(item.id)}><span className={`work-impact ${item.impact}`}><ShieldCheck size={18}/></span><span className="work-copy"><span><strong>{item.title ?? item.action_name.replaceAll("_", " ")}</strong><span className={`status ${item.status}`}><i/>{item.status}</span></span><small>{item.description ?? "Human authorization requested"}</small><em>{item.action_name.replaceAll("_", " ")} · Execution {item.execution_id.slice(0, 8)}</em></span><span className="work-meta"><small><Clock3 size={13}/>{formatDate(item.requested_at)}</small><strong>{item.assigned_to ?? "Unassigned"}</strong></span><ChevronRight size={18}/></button>) : <div className="work-empty"><Check size={25}/><strong>Nothing waiting here</strong><span>New human checkpoints will be routed into this queue.</span></div>}</div>
  </section>;
}

function formatDate(value: string): string {
  const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
