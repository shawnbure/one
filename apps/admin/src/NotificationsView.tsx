import { useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, RefreshCw } from "lucide-react";
import { api, type NotificationData } from "./api";

export function NotificationsView({ onNotice }: { onNotice: (message: string) => void }) {
  const [data, setData] = useState<NotificationData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function load() { try { setData((await api.notifications()).data); } catch (error) { onNotice(error instanceof Error ? error.message : "Notification center could not load"); } }
  useEffect(() => { void load(); }, []);
  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    try { await api.updateNotificationPolicy(id, { enabled }); await load(); onNotice(`Notification policy ${enabled ? "enabled" : "disabled"}.`); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Policy update failed"); }
    finally { setBusy(null); }
  }
  if (!data) return <div className="loading-card">Loading notification center…</div>;
  return <section className="notifications-page"><div className="page-title"><div><span className="eyebrow"><Bell size={14}/> OPERATIONAL RESPONSE</span><h1>Notifications</h1><p>Route approvals, failures, exhausted retries, and control violations to accountable owners.</p></div><button className="refresh-button" onClick={() => void load()}><RefreshCw size={15}/>Refresh</button></div>
    <div className="notification-layout"><article className="policy-list panel"><div className="section-head"><div><h2>Routing policies</h2><p>In-app delivery is live. Email and webhook channels remain pending until credentials are configured.</p></div></div>{data.policies.map((policy) => <div className="policy-row" key={policy.id}><span className={`severity ${policy.severity}`}><AlertTriangle size={16}/></span><span><strong>{policy.event_type.replaceAll("_", " ").replaceAll(".", " · ")}</strong><small>{policy.channel.replaceAll("_", " ")} · {policy.destination ?? "Workrr notification center"}</small></span><span className={`delivery ${policy.enabled ? "enabled" : "disabled"}`}>{policy.enabled ? "Enabled" : "Disabled"}</span><button disabled={busy === policy.id} onClick={() => void toggle(policy.id, !policy.enabled)}>{policy.enabled ? "Disable" : "Enable"}</button></div>)}</article>
      <aside className="event-list panel"><div className="section-head"><div><h2>Recent events</h2><p>Persisted delivery evidence.</p></div></div>{data.events.length ? data.events.map((event) => <div className="event-row" key={event.id}><CheckCircle2 size={16}/><span><strong>{event.title}</strong><small>{event.detail}</small><em>{event.delivery_status} · {formatDate(event.created_at)}</em></span></div>) : <div className="work-empty"><Bell size={24}/><strong>No notification events</strong><span>Operational alerts will appear here.</span></div>}</aside></div>
  </section>;
}
function formatDate(value: string) { const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
