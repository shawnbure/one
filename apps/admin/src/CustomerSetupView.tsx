import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Download, Settings2, ShieldCheck } from "lucide-react";
import { api, type OnboardingData, type SessionData } from "./api";

export function CustomerSetupView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ organizationName: "", supportEmail: "", accentColor: "#1f7a5b", defaultModelProfile: "balanced", dataRegion: "Cloudflare global network" });

  async function load() {
    try {
      const result = (await api.onboarding()).data;
      setData(result);
      if (result.settings) setForm({ organizationName: result.settings.organization_name, supportEmail: result.settings.support_email,
        accentColor: result.settings.accent_color, defaultModelProfile: result.settings.default_model_profile, dataRegion: result.settings.data_region });
    } catch (error) { onNotice(error instanceof Error ? error.message : "Customer setup could not load"); }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true);
    try { setData((await api.updateOnboarding(form)).data); onNotice("Customer environment profile saved and audited."); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Customer setup could not be saved"); }
    finally { setSaving(false); }
  }

  if (!data) return <div className="loading-card">Loading customer setup…</div>;
  const ready = data.checklist.filter((item) => item.ready).length;
  return <section className="setup-page">
    <div className="page-title"><div><span className="eyebrow"><Settings2 size={14}/> CUSTOMER ENVIRONMENT</span><h1>Customer setup</h1><p>One controlled manifest establishes the customer identity, operating defaults, and deployment handoff.</p></div>
      <a className="export-button" href="/api/onboarding/export"><Download size={15}/>Export portable manifest</a></div>
    <div className="setup-layout">
      <article className="setup-form panel">
        <div className="section-head"><div><h2>Organization profile</h2><p>Non-secret configuration that follows this customer deployment.</p></div><span>{session?.user.role ?? "viewer"}</span></div>
        <label>Organization name<input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })}/></label>
        <label>Support and security contact<input type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}/></label>
        <div className="setup-fields"><label>Brand accent<input type="color" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })}/></label>
          <label>Default model profile<select value={form.defaultModelProfile} onChange={(e) => setForm({ ...form, defaultModelProfile: e.target.value })}><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="reasoning">Reasoning</option></select></label></div>
        <label>Data execution boundary<input value={form.dataRegion} onChange={(e) => setForm({ ...form, dataRegion: e.target.value })}/></label>
        <div className="setup-note"><ShieldCheck size={17}/><span><strong>Secrets are intentionally excluded</strong><small>Credentials remain Cloudflare secrets and are never placed in a manifest or D1 export.</small></span></div>
        <button className="primary setup-save" disabled={saving || session?.user.role !== "admin"} onClick={() => void save()}>{saving ? "Saving…" : "Save customer profile"}</button>
      </article>
      <aside className="setup-checklist panel"><span className="score-ring">{ready}/{data.checklist.length}</span><h2>Environment readiness</h2><p>These controls make the deployment supportable before customer handoff.</p>
        <div>{data.checklist.map((item) => <span key={item.id} className={item.ready ? "ready" : "pending"}>{item.ready ? <CheckCircle2 size={17}/> : <Circle size={17}/>}<strong>{item.label}</strong><small>{item.ready ? "Ready" : "Action required"}</small></span>)}</div>
      </aside>
    </div>
  </section>;
}
