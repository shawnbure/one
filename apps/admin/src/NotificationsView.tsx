import { useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, KeyRound, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { api, type Member, type NotificationData, type SessionData } from "./api";

export function NotificationsView({ session, onNotice }: {
  session: SessionData | null;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<NotificationData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [responsePolicies, setResponsePolicies] = useState<Record<string, {
    ownerId: string; acknowledgementRequired: boolean; escalationMinutes: number;
  }>>({});
  const [acknowledgementNotes, setAcknowledgementNotes] = useState<Record<string, string>>({});
  const canConfigure = session?.user.role === "admin" || session?.user.role === "owner";
  const canAcknowledge = canConfigure || session?.user.role === "operator";
  async function load() { try {
    const [notificationResult, memberResult] = await Promise.all([api.notifications(), api.members()]);
    const next = notificationResult.data;
    setData(next);
    setMembers(memberResult.data.filter((member) => member.status === "active" &&
      ["admin", "owner", "operator"].includes(member.role)));
    setDestinations(Object.fromEntries(next.policies.map((policy) => [policy.id, policy.destination ?? ""])));
    setResponsePolicies(Object.fromEntries(next.policies.map((policy) => [policy.id, {
      ownerId: policy.owner_id ?? "", acknowledgementRequired: Boolean(policy.acknowledgement_required),
      escalationMinutes: Number(policy.escalation_minutes)
    }])));
  } catch (error) { onNotice(error instanceof Error ? error.message : "Notification center could not load"); } }
  useEffect(() => { void load(); }, []);
  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    try { await api.updateNotificationPolicy(id, { enabled }); await load(); onNotice(`Notification policy ${enabled ? "enabled" : "disabled"}.`); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Policy update failed"); }
    finally { setBusy(null); }
  }
  async function saveDestination(id: string) {
    setBusy(id);
    try { await api.updateNotificationPolicy(id, { destination: destinations[id] || null }); await load(); onNotice("Notification destination saved without storing credential material."); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Destination update failed"); }
    finally { setBusy(null); }
  }
  async function test(id: string) {
    setBusy(id);
    try { await api.testNotificationPolicy(id); await load(); onNotice("External delivery test queued."); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Delivery test failed"); }
    finally { setBusy(null); }
  }
  async function saveResponsePolicy(id: string) {
    const policy = responsePolicies[id];
    if (!policy) return;
    setBusy(id);
    try {
      await api.updateNotificationPolicy(id, policy);
      await load();
      onNotice("Notification ownership and acknowledgement SLA saved.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Response policy could not be saved"); }
    finally { setBusy(null); }
  }
  async function acknowledge(id: string) {
    setBusy(id);
    try {
      await api.acknowledgeNotification(id, acknowledgementNotes[id] ?? "");
      await load();
      onNotice("Operational alert acknowledged with attributable evidence.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Alert could not be acknowledged"); }
    finally { setBusy(null); }
  }
  if (!data) return <div className="loading-card">Loading notification center…</div>;
  return <section className="notifications-page"><div className="page-title"><div><span className="eyebrow"><Bell size={14}/> OPERATIONAL RESPONSE</span><h1>Notifications</h1><p>Route approvals, failures, exhausted retries, and control violations to accountable owners.</p></div><button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh</button></div>
    <div className="delivery-credentials"><div className="credential-summary panel"><span className="foundation-icon"><KeyRound size={18}/></span><span><strong>Cloudflare webhook credential</strong><small>{data.credentials[0]?.purpose ?? "No external delivery credential is registered."}</small></span><span className={`connection-state ${data.credentials[0]?.configured ? "healthy" : "attention"}`}><i/>{data.credentials[0]?.configured ? "Configured" : "Required"}</span></div>
      <div className="credential-summary panel"><span className="foundation-icon"><Send size={18}/></span><span><strong>Microsoft 365 email</strong><small>{data.microsoftEmail?.account_email ?? data.microsoftEmail?.account_name ?? "Connect a delegated account with Mail.Send."}</small></span><span className={`connection-state ${data.microsoftEmail?.configured ? "healthy" : "attention"}`}><i/>{data.microsoftEmail?.configured ? "Ready" : "Required"}</span></div></div>
    <div className="notification-layout"><article className="policy-list panel"><div className="section-head"><div><h2>Routing policies</h2><p>In-app alerts are owned response tasks. Webhook and Microsoft email rows are provider-delivery evidence.</p></div></div>{data.policies.map((policy) => {
      const response = responsePolicies[policy.id] ?? { ownerId: "", acknowledgementRequired: false, escalationMinutes: 0 };
      return <div className={`policy-row ${policy.channel !== "in_app" ? "external-policy" : ""}`} key={policy.id}><span className={`severity ${policy.severity}`}><AlertTriangle size={16}/></span><span><strong>{policy.event_type.replaceAll("_", " ").replaceAll(".", " · ")}</strong><small>{policy.channel.replaceAll("_", " ")} · {policy.destination ?? "Workrr notification center"}</small>
        {policy.channel === "in_app" && canConfigure && <span className="response-policy-editor"><label>Owner<select value={response.ownerId} onChange={(event) =>
          setResponsePolicies({ ...responsePolicies, [policy.id]: { ...response, ownerId: event.target.value } })}><option value="">Unassigned</option>
          {members.map((member) => <option value={member.id} key={member.id}>{member.display_name} · {member.role}</option>)}</select></label>
          <label>Acknowledge<select value={response.acknowledgementRequired ? "yes" : "no"} onChange={(event) =>
            setResponsePolicies({ ...responsePolicies, [policy.id]: { ...response, acknowledgementRequired: event.target.value === "yes" } })}>
            <option value="yes">Required</option><option value="no">Not required</option></select></label>
          <label>Escalate after<input type="number" min="0" max="10080" value={response.escalationMinutes} onChange={(event) =>
            setResponsePolicies({ ...responsePolicies, [policy.id]: { ...response, escalationMinutes: Number(event.target.value) } })}/><small>minutes</small></label>
          <button disabled={busy === policy.id} onClick={() => void saveResponsePolicy(policy.id)}>Save response</button></span>}
        {policy.channel !== "in_app" && canConfigure && <span className="destination-editor"><input aria-label={`${policy.channel === "email" ? "Email" : "Webhook"} destination`} placeholder={policy.channel === "email" ? "operations@customer.example" : "https://customer.example/workrr-events"} value={destinations[policy.id] ?? ""} onChange={(event) => setDestinations((current) => ({ ...current, [policy.id]: event.target.value }))}/><button disabled={busy === policy.id} onClick={() => void saveDestination(policy.id)}>{policy.channel === "email" ? "Save recipient" : "Save URL"}</button><button disabled={busy === policy.id || !policy.credential_configured || !policy.destination} onClick={() => void test(policy.id)}><Send size={13}/>Test</button></span>}</span><span className={`delivery ${policy.enabled ? "enabled" : "disabled"}`}>{policy.enabled ? "Enabled" : "Disabled"}</span>{canConfigure && <button disabled={busy === policy.id} onClick={() => void toggle(policy.id, !policy.enabled)}>{policy.enabled ? "Disable" : "Enable"}</button>}</div>;
    })}</article>
      <aside className="event-list panel"><div className="section-head"><div><h2>Recent events</h2><p>Human response and external delivery remain separate evidence.</p></div></div>{data.events.length ? data.events.map((event) => <div className={`event-row ${event.delivery_status} ${event.escalated_at ? "escalated" : ""}`} key={event.id}>{event.acknowledged_at || event.delivery_status === "delivered" ? <CheckCircle2 size={16}/> : <ShieldCheck size={16}/>}<span><strong>{event.title}</strong><small>{event.detail}</small><em>{event.channel === "in_app" ? `owner ${event.owner_name ?? "unassigned"} · ${event.acknowledged_at ? `acknowledged by ${event.acknowledged_by_name ?? "operator"}` : event.escalated_at ? "escalated" : `acknowledge within ${event.escalation_minutes} minutes`}` : `${event.delivery_status === "delivered" && event.response_status === 202 ? "accepted by provider" : event.delivery_status} · ${event.attempt_count ? `${event.attempt_count} attempt${event.attempt_count === 1 ? "" : "s"} · ` : ""}`}{formatDate(event.created_at)}</em>
        {event.acknowledgement_note && <small className="acknowledgement-note">{event.acknowledgement_note}</small>}
        {event.last_error && <small className="delivery-error">{event.last_error}</small>}
        {event.channel === "in_app" && Boolean(event.acknowledgement_required) && !event.acknowledged_at && canAcknowledge && <span className="acknowledgement-editor">
          <input maxLength={1000} placeholder="Optional response note…" value={acknowledgementNotes[event.id] ?? ""} onChange={(input) =>
            setAcknowledgementNotes({ ...acknowledgementNotes, [event.id]: input.target.value })}/>
          <button disabled={busy === event.id} onClick={() => void acknowledge(event.id)}>Acknowledge</button></span>}</span></div>) : <div className="work-empty"><Bell size={24}/><strong>No notification events</strong><span>Operational alerts will appear here.</span></div>}</aside></div>
  </section>;
}
function formatDate(value: string) { const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
