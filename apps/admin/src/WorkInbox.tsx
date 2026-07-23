import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Clock3, FileText, Inbox, MessageSquare,
  Pencil, Send, ShieldCheck, UserRound, X } from "lucide-react";
import { api, type Approval, type ApprovalAssignee, type ApprovalDetail, type ApprovalMessage, type AuditEvent,
  type SessionData, type ToolActionDispatch } from "./api";

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
  const [actions, setActions] = useState<ToolActionDispatch[]>([]);
  const [messages, setMessages] = useState<ApprovalMessage[]>([]);
  const [assignees, setAssignees] = useState<ApprovalAssignee[]>([]);
  const [messageText, setMessageText] = useState("");
  const [note, setNote] = useState("");
  const [editingProposal, setEditingProposal] = useState(false);
  const [editedOutput, setEditedOutput] = useState("");
  const [editedTools, setEditedTools] = useState<Record<string, string>>({});
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => items.filter((item) => filter === "all" || (filter === "pending" ? item.status === "pending" : item.status !== "pending")), [items, filter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null); setAudit([]); setActions([]); setMessages([]); setAssignees([]); return;
    }
    void Promise.all([
      api.approval(selectedId),
      canAssign(session) ? api.approvalAssignees() : Promise.resolve({ data: [] as ApprovalAssignee[] })
    ]).then(([result, assignment]) => {
      setDetail(result.data); setAudit(result.audit); setActions(result.actions);
      setMessages(result.messages); setAssignees(assignment.data);
    }).catch((error: Error) => onNotice(error.message));
  }, [selectedId, session?.user.role]);

  async function refreshDetail() {
    if (!detail) return;
    const result = await api.approval(detail.id);
    setDetail(result.data); setAudit(result.audit); setActions(result.actions); setMessages(result.messages);
  }

  async function decide(decision: "approved" | "rejected") {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.decideApproval(detail.id, decision, detail.revision, note.trim() || undefined);
      if (!result.updated) throw new Error("This item was already resolved by another reviewer.");
      onNotice(decision === "approved"
        ? result.dispatched
          ? `${result.dispatched} approved action${result.dispatched === 1 ? "" : "s"} queued${result.enqueueFailed ? `; ${result.enqueueFailed} awaiting automatic enqueue recovery` : ""}.`
          : "Outcome approved. No external action was required."
        : "Action declined. No external change was made.");
      setSelectedId(null); setNote(""); await onRefresh();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Decision failed"); }
    finally { setBusy(false); }
  }

  async function operateAction(action: ToolActionDispatch, operation: "retry" | "cancel") {
    if (!detail) return;
    setBusy(true);
    try {
      const result = operation === "retry"
        ? await api.retryToolAction(action.id)
        : await api.cancelToolAction(action.id, note.trim() || undefined);
      onNotice(operation === "retry"
        ? `Approved action is ${result.status.replaceAll("_", " ")}. Provider idempotency remains unchanged.`
        : "Approved action delivery was cancelled before provider completion.");
      await refreshDetail();
      await onRefresh();
    } catch (error) { onNotice(error instanceof Error ? error.message : `Action ${operation} failed`); }
    finally { setBusy(false); }
  }

  async function assign(assignedTo: string) {
    if (!detail || !assignedTo) return;
    setBusy(true);
    try {
      const result = await api.assignApproval(detail.id, assignedTo);
      onNotice(`Review assigned to ${result.displayName}.`);
      await refreshDetail(); await onRefresh();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Assignment failed"); }
    finally { setBusy(false); }
  }

  async function collaborate(kind: ApprovalMessage["kind"]) {
    if (!detail || !messageText.trim()) {
      onNotice("Enter a collaboration note first."); return;
    }
    setBusy(true);
    try {
      const result = (await api.addApprovalMessage(detail.id, kind, messageText)).data;
      setMessageText("");
      onNotice(kind === "information_request" ? "Information requested; approval is paused."
        : kind === "information_response" ? "Information response recorded; decision is available again."
          : kind === "escalation" ? `Review escalated to level ${result.escalationLevel}.`
            : "Comment added to the review record.");
      await refreshDetail(); await onRefresh();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Collaboration update failed"); }
    finally { setBusy(false); }
  }

  function startProposalEdit() {
    if (!detail) return;
    setEditedOutput(detail.output_preview ?? "");
    setEditedTools(Object.fromEntries(proposedActions(detail.action_input_json)
      .map((action) => [action.id, prettyJson(action.input_json)])));
    setEditReason(""); setEditingProposal(true);
  }

  async function saveProposalEdit() {
    if (!detail) return;
    setBusy(true);
    try {
      const actions = proposedActions(detail.action_input_json);
      const toolEdits = actions.map((action) => {
        const value = editedTools[action.id] ?? "{}";
        try { return { invocationId: action.id, input: JSON.parse(value) as unknown }; }
        catch { throw new Error(`${action.tool_name.replaceAll("_", " ")} input must be valid JSON`); }
      }).filter((edit, index) => editedTools[actions[index]!.id] !== prettyJson(actions[index]!.input_json));
      const outputChanged = editedOutput.trim() !== (detail.output_preview ?? "").trim();
      if (!outputChanged && !toolEdits.length) throw new Error("Change the proposal before saving.");
      await api.reviseApprovalProposal(detail.id, {
        expectedRevision: detail.revision,
        proposedOutput: outputChanged ? editedOutput.trim() : undefined,
        toolEdits, reason: editReason.trim()
      });
      setEditingProposal(false);
      await refreshDetail(); await onRefresh();
      onNotice("Proposal corrected with revision and audit evidence. Review the updated content before approval.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Proposal could not be edited"); }
    finally { setBusy(false); }
  }

  if (selectedId) return <section className="inbox-page detail-page">
    <button className="back-link" onClick={() => setSelectedId(null)}><ArrowLeft size={15}/>Back to work inbox</button>
    {!detail ? <div className="loading-card">Loading review evidence…</div> : <div className="review-layout">
      <article className="review-main panel">
        <div className="review-heading"><span className="review-icon"><FileText size={20}/></span><div><span className={`status ${detail.status}`}><span/>{detail.status}</span>
          {detail.review_state !== "decision_pending" && <span className={`review-state ${detail.review_state}`}>
            {detail.review_state.replaceAll("_", " ")}{detail.escalation_level ? ` · level ${detail.escalation_level}` : ""}</span>}
          <h1>{detail.title ?? detail.action_name.replaceAll("_", " ")}</h1><p>{detail.description ?? "An AI process has requested a human decision."}</p></div></div>
        <div className="evidence-block"><label>SOURCE REQUEST</label><p>{detail.input_preview}</p></div>
        <div className="evidence-block proposed"><label>PROPOSED OUTPUT</label><p>{detail.output_preview ?? "The process did not attach an output preview."}</p></div>
        {proposedActions(detail.action_input_json).map((action, index) => <div className="evidence-block proposed" key={`${action.tool_name}-${index}`}>
          <label>PROPOSED EXTERNAL ACTION</label>
          <p><strong>{action.tool_name.replaceAll("_", " ")}</strong> · {action.risk_level} risk</p>
          <pre>{prettyJson(action.input_json)}</pre>
        </div>)}
        {actions.length > 0 && <div className="run-tool-evidence invocation-evidence">
          <div><ShieldCheck size={17}/><span><strong>Approved action delivery</strong><small>Approval and provider execution are recorded separately</small></span></div>
          {actions.map((action) => <span key={action.id}><strong>{action.tool_name.replaceAll("_", " ")}</strong>
            <small>{action.status.replaceAll("_", " ")} · {action.attempt_count} attempt{action.attempt_count === 1 ? "" : "s"}</small>
            <em>{action.provider_resource_id ? `Provider confirmed resource ${action.provider_resource_id}` : action.last_error ?? actionStatus(action.status)}</em>
            {canOperate(session) && action.status === "failed" &&
              <button disabled={busy} onClick={() => void operateAction(action, "retry")}>Retry safely</button>}
            {canOperate(session) && ["pending", "queued", "retrying", "enqueue_failed"].includes(action.status) &&
              <button disabled={busy} onClick={() => void operateAction(action, "cancel")}>Cancel delivery</button>}
          </span>)}
        </div>}
        <div className="decision-context"><span><ShieldCheck size={17}/><div><strong>{detail.impact} impact</strong><small>{detail.autonomy_level ? `${detail.autonomy_level} autonomy routed this proposal to review` : "Human authorization required by process policy"}</small></div></span><span><UserRound size={17}/><div><strong>{detail.assigned_to ?? "Unassigned"}</strong><small>{detail.delegated_from_name ? `Covering for ${detail.delegated_from_name}` : "Assigned reviewer"}</small></div></span></div>
        {detail.status === "pending" && <div className={`approval-sla ${detail.overdue ? "overdue" : ""}`}>
          <Clock3 size={17}/><span><strong>{detail.overdue ? "Response SLA overdue" : "Response SLA active"}</strong>
            <small>{detail.due_at ? `Due ${formatDate(detail.due_at)} · open ${formatAge(detail.age_minutes)}` : "No response deadline is configured."}
              {detail.sla_escalated_at ? ` · escalated ${formatDate(detail.sla_escalated_at)}` : ""}</small></span>
        </div>}
        {detail.status === "pending" && canAssign(session) && <div className="assignment-control">
          <label htmlFor="approval-assignee">Responsible reviewer</label>
          <select id="approval-assignee" disabled={busy} value={detail.assigned_to ?? ""}
            onChange={(event) => void assign(event.target.value)}>
            <option value="">Choose an active reviewer…</option>
            {assignees.map((member) => <option key={member.id} value={member.email}>
              {member.display_name} · {member.role}
            </option>)}
          </select>
          {session && detail.assigned_to !== session.user.email &&
            <button disabled={busy} onClick={() => void assign(session.user.email)}>Assign to me</button>}
        </div>}
        {(messages.length > 0 || (detail.status === "pending" && canCollaborate(session))) && <div className="approval-collaboration">
          <div><MessageSquare size={17}/><span><strong>Review discussion</strong>
            <small>Comments do not authorize external action. Every entry is retained in the audit record.</small></span></div>
          <div className="approval-messages">{messages.length ? messages.map((message) => <article key={message.id}>
            <span><strong>{message.author_email}</strong><em>{message.kind.replaceAll("_", " ")}</em></span>
            <p>{message.body}</p><small>{formatDate(message.created_at)}</small>
          </article>) : <p className="empty-discussion">No discussion yet.</p>}</div>
          {detail.status === "pending" && canCollaborate(session) && <>
            <textarea value={messageText} onChange={(event) => setMessageText(event.target.value)}
              placeholder={detail.review_state === "information_requested"
                ? "Provide the requested information with its source…" : "Add context, a question, or an escalation reason…"}/>
            <div className="collaboration-actions">
              <button disabled={busy} onClick={() => void collaborate("comment")}><Send size={14}/>Add comment</button>
              {canRequestInfo(session) && detail.review_state !== "information_requested" &&
                <button disabled={busy} onClick={() => void collaborate("information_request")}>Request information</button>}
              {canRespondInfo(session) && detail.review_state === "information_requested" &&
                <button disabled={busy} className="respond" onClick={() => void collaborate("information_response")}>Submit information</button>}
              {canEscalate(session) && <button disabled={busy || detail.escalation_level >= 3}
                onClick={() => void collaborate("escalation")}><AlertTriangle size={14}/>Escalate</button>}
            </div>
          </>}
        </div>}
        {detail.status === "pending" && canEditProposal(session) && <div className="proposal-edit-control">
          <div><Pencil size={17}/><span><strong>Correct before approval</strong>
            <small>Edits are DLP-scanned, contract-checked, revision-locked, and audited. Saving does not approve or execute anything.</small></span>
            {!editingProposal && <button onClick={startProposalEdit}>Edit proposal</button>}</div>
          {editingProposal && <div className="proposal-editor">
            {detail.output_preview !== null && <label>Proposed output<textarea maxLength={4000}
              value={editedOutput} onChange={(event) => setEditedOutput(event.target.value)}/></label>}
            {proposedActions(detail.action_input_json).map((action) => <label key={action.id}>
              {action.tool_name.replaceAll("_", " ")} input
              <textarea className="proposal-json" maxLength={8000} value={editedTools[action.id] ?? "{}"}
                onChange={(event) => setEditedTools((current) => ({ ...current, [action.id]: event.target.value }))}/>
            </label>)}
            <label>Edit reason<textarea maxLength={500} value={editReason}
              placeholder="What was corrected and why?"
              onChange={(event) => setEditReason(event.target.value)}/></label>
            <footer><button onClick={() => setEditingProposal(false)}>Cancel</button>
              <button className="save" disabled={busy || editReason.trim().length < 5}
                onClick={() => void saveProposalEdit()}>{busy ? "Saving…" : "Save corrected proposal"}</button></footer>
          </div>}
        </div>}
        {detail.status === "pending" && <div className="decision-box"><label htmlFor="decision-note">Decision rationale <em>optional</em></label><textarea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for the process owner and audit record…"/><div><button disabled={busy} onClick={() => void decide("rejected")}><X size={16}/>Decline</button><button disabled={busy || detail.review_state === "information_requested"} className="approve" onClick={() => void decide("approved")}><Check size={16}/>{busy ? "Recording…" : detail.review_state === "information_requested" ? "Waiting for information" : proposedActions(detail.action_input_json).length ? "Approve & queue action" : "Approve outcome"}</button></div></div>}
      </article>
      <aside className="review-side panel"><h2>Decision record</h2><dl><div><dt>Process</dt><dd>{detail.blueprint_id.replaceAll("-", " ")}</dd></div><div><dt>Requested</dt><dd>{formatDate(detail.requested_at)}</dd></div><div><dt>Due</dt><dd>{detail.due_at ? formatDate(detail.due_at) : "No deadline"}</dd></div><div><dt>Model</dt><dd>{detail.model?.split("/").at(-1) ?? "Not recorded"}</dd></div></dl><h3>Audit timeline</h3><div className="audit-line"><span><i/><strong>Approval requested</strong><small>{formatDate(detail.requested_at)}</small></span>{audit.map((event) => <span key={`${event.event_type}-${event.created_at}`}><i/><strong>{event.event_type.replaceAll(".", " ")}</strong><small>{formatDate(event.created_at)} · {event.actor_id}</small></span>)}</div></aside>
    </div>}
  </section>;

  return <section className="inbox-page">
    <div className="page-title"><div><span className="eyebrow"><Inbox size={14}/> HUMAN CONTROL</span><h1>Work inbox</h1><p>Review consequential actions with the evidence and context needed to decide safely.</p></div><div className="assignment-chip"><UserRound size={15}/><span><small>VIEWING AS</small><strong>{session?.user.name ?? "Authorized reviewer"}</strong></span></div></div>
    <div className="inbox-tabs">{(["pending", "resolved", "all"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{value === "pending" ? items.filter((item) => item.status === "pending").length : value === "resolved" ? items.filter((item) => item.status !== "pending").length : items.length}</span></button>)}</div>
    <div className="work-list panel">{filtered.length ? filtered.map((item) => <button key={item.id} className={`work-row ${item.overdue ? "overdue" : ""}`} onClick={() => setSelectedId(item.id)}><span className={`work-impact ${item.impact}`}><ShieldCheck size={18}/></span><span className="work-copy"><span><strong>{item.title ?? item.action_name.replaceAll("_", " ")}</strong><span className={`status ${item.status}`}><i/>{item.status}</span>{item.status === "pending" && item.review_state !== "decision_pending" &&
      <span className={`review-state ${item.review_state}`}>{item.review_state.replaceAll("_", " ")}</span>}</span><small>{item.description ?? "Human authorization requested"}</small><em>{item.action_name.replaceAll("_", " ")} · Execution {item.execution_id.slice(0, 8)}</em></span><span className="work-meta"><small><Clock3 size={13}/>{item.status === "pending" && item.due_at
        ? `${item.overdue ? "Overdue" : "Due"} ${formatDate(item.due_at)}`
        : formatDate(item.requested_at)}</small><strong>{item.assigned_to ?? "Unassigned"}</strong>
        {item.delegated_from_name && <small>Covering for {item.delegated_from_name}</small>}
        {item.status === "pending" && <em>{formatAge(item.age_minutes)} open</em>}</span><ChevronRight size={18}/></button>) : <div className="work-empty"><Check size={25}/><strong>Nothing waiting here</strong><span>New human checkpoints will be routed into this queue.</span></div>}</div>
  </section>;
}

function proposedActions(value: string): Array<{ id: string; tool_name: string; risk_level: string; input_json: string }> {
  try {
    const parsed = JSON.parse(value) as { proposedActions?: Array<{ id: string; tool_name: string; risk_level: string; input_json: string }> };
    return Array.isArray(parsed.proposedActions) ? parsed.proposedActions : [];
  } catch { return []; }
}

function prettyJson(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function actionStatus(status: ToolActionDispatch["status"]): string {
  if (status === "completed") return "Provider completion evidence recorded.";
  if (status === "enqueue_failed") return "Safe for automatic enqueue recovery; no provider call has started.";
  if (["pending", "queued"].includes(status)) return "Waiting for the governed Queue worker.";
  if (status === "processing") return "Calling the fixed provider adapter.";
  if (status === "retrying") return "A bounded Queue retry is pending.";
  return "No provider completion was recorded.";
}

function canOperate(session: SessionData | null) {
  return Boolean(session && ["admin", "owner", "operator"].includes(session.user.role));
}
function canAssign(session: SessionData | null) {
  return Boolean(session && ["admin", "owner", "operator", "reviewer"].includes(session.user.role));
}
function canCollaborate(session: SessionData | null) {
  return Boolean(session && ["admin", "builder", "owner", "operator", "reviewer"].includes(session.user.role));
}
function canRequestInfo(session: SessionData | null) {
  return Boolean(session && ["admin", "owner", "reviewer"].includes(session.user.role));
}
function canRespondInfo(session: SessionData | null) {
  return Boolean(session && ["admin", "builder", "owner", "operator"].includes(session.user.role));
}
function canEscalate(session: SessionData | null) {
  return Boolean(session && ["admin", "owner", "operator", "reviewer"].includes(session.user.role));
}
function canEditProposal(session: SessionData | null) {
  return Boolean(session && ["admin", "owner", "reviewer"].includes(session.user.role));
}

function formatDate(value: string): string {
  const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function formatAge(minutes = 0): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}
