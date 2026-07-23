import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Download, Rocket, Settings2, ShieldCheck, UserPlus } from "lucide-react";
import { api, type OnboardingData, type ProcessTemplate, type SessionData } from "./api";

export function CustomerSetupView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ organizationName: "", supportEmail: "", accentColor: "#1f7a5b", defaultModelProfile: "balanced", dataRegion: "Cloudflare global network" });
  const [launch, setLaunch] = useState({
    templateId: "template-customer-ops", processName: "Customer Operations", purpose: "Triage customer requests and prepare approved responses.",
    businessOwner: "Operations", department: "Operations", riskLevel: "medium", volumePerMonth: 500, minutesPerItem: 10,
    hourlyCost: 40, errorRatePercent: 5, teammateName: "", teammateEmail: "", teammateRole: "operator"
  });

  async function load() {
    try {
      const [result, templateResult] = await Promise.all([api.onboarding(), api.processTemplates()]);
      setTemplates(templateResult.data);
      const next = result.data;
      setData(next);
      if (next.settings) setForm({ organizationName: next.settings.organization_name, supportEmail: next.settings.support_email,
        accentColor: next.settings.accent_color, defaultModelProfile: next.settings.default_model_profile, dataRegion: next.settings.data_region });
    } catch (error) { onNotice(error instanceof Error ? error.message : "Customer setup could not load"); }
  }

  async function bootstrap() {
    setLaunching(true);
    try {
      const teammate = launch.teammateEmail.trim() && launch.teammateName.trim()
        ? { email: launch.teammateEmail.trim(), name: launch.teammateName.trim(), role: launch.teammateRole } : undefined;
      const result = await api.bootstrapCustomer({
        ...form, idempotencyKey, member: teammate,
        firstProcess: {
          templateId: launch.templateId, name: launch.processName, purpose: launch.purpose,
          businessOwner: launch.businessOwner, department: launch.department, riskLevel: launch.riskLevel,
          baseline: { volumePerMonth: launch.volumePerMonth, minutesPerItem: launch.minutesPerItem,
            hourlyCost: launch.hourlyCost, errorRate: launch.errorRatePercent / 100 }
        }
      });
      setData(result.data);
      onNotice(result.data.launch.alreadyCompleted ? "Customer baseline was already complete." : "Customer baseline launched as a paused, reviewable draft.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Customer launch failed"); }
    finally { setLaunching(false); }
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
    <article className="setup-launch panel">
      <div className="section-head"><div><h2>Customer launch package</h2><p>Provision one supportable baseline. The first process remains paused and draft until its evaluation and release review pass.</p></div><span className={`connection-state ${data.bootstrap?.status === "completed" ? "healthy" : "attention"}`}><i/>{data.bootstrap?.status ?? "Not launched"}</span></div>
      {data.bootstrap?.status === "completed" ? <div className="launch-complete"><span className="launch-icon"><CheckCircle2 size={24}/></span><span><strong>Baseline environment established</strong><small>Process {data.bootstrap.process_id} · membership {data.bootstrap.member_id} · completed {formatDate(data.bootstrap.completed_at)}</small></span><ShieldCheck size={20}/></div> :
      <div className="launch-grid">
        <div className="launch-process">
          <h3><Rocket size={16}/> First process</h3>
          <label>Starting template<select value={launch.templateId} onChange={(event) => setLaunch({ ...launch, templateId: event.target.value })}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <div className="setup-fields"><label>Process name<input value={launch.processName} onChange={(event) => setLaunch({ ...launch, processName: event.target.value })}/></label><label>Department<input value={launch.department} onChange={(event) => setLaunch({ ...launch, department: event.target.value })}/></label></div>
          <label>Business purpose<textarea value={launch.purpose} onChange={(event) => setLaunch({ ...launch, purpose: event.target.value })}/></label>
          <div className="setup-fields"><label>Business owner<input value={launch.businessOwner} onChange={(event) => setLaunch({ ...launch, businessOwner: event.target.value })}/></label><label>Risk level<select value={launch.riskLevel} onChange={(event) => setLaunch({ ...launch, riskLevel: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
          <div className="baseline-fields"><label>Items / month<input type="number" min="0" value={launch.volumePerMonth} onChange={(event) => setLaunch({ ...launch, volumePerMonth: Number(event.target.value) })}/></label><label>Minutes / item<input type="number" min="0" value={launch.minutesPerItem} onChange={(event) => setLaunch({ ...launch, minutesPerItem: Number(event.target.value) })}/></label><label>Hourly cost<input type="number" min="0" value={launch.hourlyCost} onChange={(event) => setLaunch({ ...launch, hourlyCost: Number(event.target.value) })}/></label><label>Error rate %<input type="number" min="0" max="100" value={launch.errorRatePercent} onChange={(event) => setLaunch({ ...launch, errorRatePercent: Number(event.target.value) })}/></label></div>
        </div>
        <div className="launch-member">
          <h3><UserPlus size={16}/> First operating teammate <em>Optional</em></h3>
          <p>The authenticated administrator is already retained. Add the first operator now or manage the team later.</p>
          <label>Name<input value={launch.teammateName} onChange={(event) => setLaunch({ ...launch, teammateName: event.target.value })}/></label>
          <label>Email<input type="email" value={launch.teammateEmail} onChange={(event) => setLaunch({ ...launch, teammateEmail: event.target.value })}/></label>
          <label>Role<select value={launch.teammateRole} onChange={(event) => setLaunch({ ...launch, teammateRole: event.target.value })}><option value="operator">Operator</option><option value="owner">Owner</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option><option value="builder">Builder</option></select></label>
          <div className="setup-note"><ShieldCheck size={17}/><span><strong>Safe first state</strong><small>The process is paused, the release is draft, and no connector credential is included.</small></span></div>
          <button className="primary launch-button" disabled={launching || session?.user.role !== "admin"} onClick={() => void bootstrap()}><Rocket size={15}/>{launching ? "Launching…" : "Launch customer baseline"}</button>
        </div>
      </div>}
    </article>
  </section>;
}
function formatDate(value: string | null) {
  if (!value) return "recorded";
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
