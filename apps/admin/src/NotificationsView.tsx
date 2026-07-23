import { useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, KeyRound, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { api, type NotificationData } from "./api";

export function NotificationsView({ onNotice }: { onNotice: (message: string) => void }) {
  const [data, setData] = useState<NotificationData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  async function load() { try {
    const next = (await api.notifications()).data;
    setData(next);
    setDestinations(Object.fromEntries(next.policies.map((policy) => [policy.id, policy.destination ?? ""])));
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
    try { await api.updateNotificationPolicy(id, { destination: destinations[id] || null }); await load(); onNotice("Webhook destination saved without storing credential material."); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Destination update failed"); }
    finally { setBusy(null); }
  }
  async function test(id: string) {
    setBusy(id);
    try { await api.testNotificationPolicy(id); await load(); onNotice("Signed webhook delivery test queued."); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Delivery test failed"); }
    finally { setBusy(null); }
  }
  if (!data) return <div className="loading-card">Loading notification center…</div>;
  return <section className="notifications-page"><div className="page-title"><div><span className="eyebrow"><Bell size={14}/> OPERATIONAL RESPONSE</span><h1>Notifications</h1><p>Route approvals, failures, exhausted retries, and control violations to accountable owners.</p></div><button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh</button></div>
    <div className="credential-summary panel"><span className="foundation-icon"><KeyRound size={18}/></span><span><strong>Cloudflare-managed delivery credential</strong><small>{data.credentials[0]?.purpose ?? "No external delivery credential is registered."}</small></span><span className={`connection-state ${data.credentials[0]?.configured ? "healthy" : "attention"}`}><i/>{data.credentials[0]?.configured ? "Configured" : "Required"}</span></div>
    <div className="notification-layout"><article className="policy-list panel"><div className="section-head"><div><h2>Routing policies</h2><p>In-app events are immediate. Signed webhooks use Queue retries and durable delivery evidence.</p></div></div>{data.policies.map((policy) => <div className={`policy-row ${policy.channel === "webhook" ? "webhook-policy" : ""}`} key={policy.id}><span className={`severity ${policy.severity}`}><AlertTriangle size={16}/></span><span><strong>{policy.event_type.replaceAll("_", " ").replaceAll(".", " · ")}</strong><small>{policy.channel.replaceAll("_", " ")} · {policy.destination ?? "Workrr notification center"}</small>{policy.channel === "webhook" && <span className="destination-editor"><input aria-label="Webhook destination" placeholder="https://customer.example/workrr-events" value={destinations[policy.id] ?? ""} onChange={(event) => setDestinations((current) => ({ ...current, [policy.id]: event.target.value }))}/><button disabled={busy === policy.id} onClick={() => void saveDestination(policy.id)}>Save URL</button><button disabled={busy === policy.id || !policy.credential_configured || !policy.destination} onClick={() => void test(policy.id)}><Send size={13}/>Test</button></span>}</span><span className={`delivery ${policy.enabled ? "enabled" : "disabled"}`}>{policy.enabled ? "Enabled" : "Disabled"}</span><button disabled={busy === policy.id} onClick={() => void toggle(policy.id, !policy.enabled)}>{policy.enabled ? "Disable" : "Enable"}</button></div>)}</article>
      <aside className="event-list panel"><div className="section-head"><div><h2>Recent events</h2><p>Persisted delivery evidence and safe failure details.</p></div></div>{data.events.length ? data.events.map((event) => <div className={`event-row ${event.delivery_status}`} key={event.id}>{event.delivery_status === "delivered" ? <CheckCircle2 size={16}/> : <ShieldCheck size={16}/>}<span><strong>{event.title}</strong><small>{event.detail}</small><em>{event.delivery_status} · {event.attempt_count ? `${event.attempt_count} attempt${event.attempt_count === 1 ? "" : "s"} · ` : ""}{formatDate(event.created_at)}</em>{event.last_error && <small className="delivery-error">{event.last_error}</small>}</span></div>) : <div className="work-empty"><Bell size={24}/><strong>No notification events</strong><span>Operational alerts will appear here.</span></div>}</aside></div>
  </section>;
}
function formatDate(value: string) { const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
