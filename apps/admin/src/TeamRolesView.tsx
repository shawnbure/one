import { useEffect, useState, type ReactNode } from "react";
import { Bot, CalendarClock, Check, LockKeyhole, Plus, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { api, type ApprovalDelegation, type Member, type ServicePrincipal, type SessionData } from "./api";
import "./machine-access.css";

const roleInfo: Record<string, string> = {
  admin: "Environment, identity, releases, and every process control",
  builder: "Build, test, and create draft process releases",
  owner: "Own processes, publish releases, and change operating modes",
  operator: "Operate runs, exceptions, assignments, and safe replay",
  reviewer: "Approve or decline consequential actions",
  viewer: "Read operations, audit, and governance information",
  consumer: "Start and participate in authorized AI processes",
};

export function TeamRolesView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [machines, setMachines] = useState<ServicePrincipal[]>([]);
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [modal, setModal] = useState<"member" | "machine" | "delegation" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [commonName, setCommonName] = useState("");
  const [machineRole, setMachineRole] = useState<"operator" | "viewer">("operator");
  const [delegatingMemberId, setDelegatingMemberId] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [delegationReason, setDelegationReason] = useState("");
  const [delegationEnabled, setDelegationEnabled] = useState(true);
  const privileged = ["admin", "owner"].includes(session?.user.role ?? "");
  async function load() { try {
    const [people, coverage, principals] = await Promise.all([
      api.members(), api.approvalDelegations(),
      ["admin", "owner", "viewer"].includes(session?.user.role ?? "") ? api.servicePrincipals() : Promise.resolve({ data: [] })
    ]);
    setMembers(people.data); setDelegations(coverage.data); setMachines(principals.data);
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load identities"); } }
  useEffect(() => { void load(); }, []);
  async function invite() { try { await api.createMember({ name, email, role }); onNotice(`${name} added. Cloudflare Access must also allow this email.`);
    setModal(null); setName(""); setEmail(""); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not add member"); } }
  async function updateMember(id: string, body: { role?: string; status?: string }) { try { await api.updateMember(id, body);
    onNotice("Membership updated and audited."); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update member"); } }
  async function addMachine() { try { await api.createServicePrincipal({ commonName, displayName: name, role: machineRole });
    onNotice("Machine identity registered. Its secret remains in your secret manager."); setModal(null); setName(""); setCommonName(""); await load();
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not add machine identity"); } }
  async function updateMachine(id: string, body: { role?: "operator" | "viewer"; status?: "active" | "suspended" }) { try {
    await api.updateServicePrincipal(id, body); onNotice("Machine identity updated and audited."); await load();
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update machine identity"); } }
  function openDelegation(member: Member) {
    const current = delegations.find((item) => item.member_id === member.id);
    const start = current ? new Date(current.starts_at) : new Date();
    const end = current ? new Date(current.ends_at) : new Date(Date.now() + 7 * 86_400_000);
    setDelegatingMemberId(member.id); setDelegateId(current?.delegate_id ?? "");
    setStartsAt(localDateTime(start)); setEndsAt(localDateTime(end));
    setDelegationReason(current?.reason ?? "Out of office coverage");
    setDelegationEnabled(current ? Boolean(current.enabled) : true); setModal("delegation");
  }
  async function saveDelegation() { try {
    const current = delegations.find((item) => item.member_id === delegatingMemberId);
    await api.setApprovalDelegation(delegatingMemberId, {
      delegateId, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
      reason: delegationReason, enabled: delegationEnabled, expectedRevision: current?.revision
    });
    onNotice("Approval coverage saved and audited."); setModal(null); await load();
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not save approval coverage"); } }

  return <section className="team-page">
    <div className="page-title"><div><span className="eyebrow"><Users size={14}/> ORGANIZATION ACCESS</span><h1>Team & roles</h1>
      <p>Cloudflare Access verifies identity. Workrr membership controls tenant scope and application capabilities.</p></div>
      {session?.user.role === "admin" && <button className="primary" onClick={() => { setName(""); setModal("member"); }}><Plus size={15}/>Add member</button>}</div>
    <div className="identity-boundary panel"><LockKeyhole size={20}/><span><strong>Two-layer identity boundary</strong>
      <small>Every person or machine must pass Cloudflare Access and have an active, tenant-scoped Workrr identity.</small></span>
      <span className="healthy"><i/>Enforced</span></div>
    <IdentityTable members={members} session={session} update={updateMember}/>
    <div className="machine-heading coverage-heading"><div><span className="eyebrow"><CalendarClock size={14}/> APPROVAL COVERAGE</span>
      <h2>Substitute approvers</h2><p>Route new approval work to a trusted teammate during a scheduled absence.</p></div></div>
    <div className="coverage-grid">
      {members.filter((member) => ["admin", "owner", "operator", "reviewer"].includes(member.role) && member.status === "active")
        .map((member) => {
          const coverage = delegations.find((item) => item.member_id === member.id);
          const manageable = privileged || member.id === session?.user.id;
          return <article className="coverage-card panel" key={member.id}><span className={coverage?.active_now ? "coverage-state active" : "coverage-state"}>
            {coverage?.active_now ? "Active now" : coverage?.enabled ? "Scheduled" : "No coverage"}</span>
            <strong>{member.display_name}</strong>
            <p>{coverage ? `Routes to ${coverage.delegate_name}` : "New approvals stay with this person."}</p>
            {coverage && <small>{formatCoverage(coverage.starts_at)} → {formatCoverage(coverage.ends_at)} · {coverage.reason}</small>}
            {manageable && <button onClick={() => openDelegation(member)}><CalendarClock size={14}/>{coverage ? "Edit coverage" : "Schedule coverage"}</button>}
          </article>;
        })}
    </div>
    <div className="machine-heading"><div><span className="eyebrow"><Bot size={14}/> MACHINE ACCESS</span><h2>Service principals</h2>
      <p>Register only an Access service-token Client ID. Workrr never receives or stores its secret.</p></div>
      {privileged && <button onClick={() => { setName(""); setModal("machine"); }}><Plus size={15}/>Add machine</button>}</div>
    <div className="members-table panel"><div className="members-head"><span>Machine</span><span>Role</span><span>Status</span><span>Last active</span></div>
      {machines.length === 0 && <div className="machine-empty">No machine identities registered.</div>}
      {machines.map((machine) => <div className="member-row" key={machine.id}><span><i><Bot size={16}/></i><span>
        <strong>{machine.display_name}</strong><small>{machine.access_common_name}</small></span></span>
        <select value={machine.role} disabled={!privileged} onChange={(event) => void updateMachine(machine.id, { role: event.target.value as "operator" | "viewer" })}>
          <option value="operator">operator</option><option value="viewer">viewer</option></select>
        <button className={`member-status ${machine.status}`} disabled={!privileged} onClick={() => void updateMachine(machine.id,
          { status: machine.status === "active" ? "suspended" : "active" })}><i/>{machine.status}</button>
        <span>{machine.last_seen_at ?? "Never"}</span></div>)}</div>
    <div className="roles-grid">{Object.entries(roleInfo).map(([roleName, description]) => <article className="panel" key={roleName}>
      <span><ShieldCheck size={17}/></span><div><strong>{roleName}</strong><small>{description}</small></div></article>)}</div>
    {modal === "member" && <IdentityModal title="Add organization member" icon={<UserRound size={20}/>}
      detail="This creates Workrr authorization. Add the same email to the customer’s Cloudflare Access policy."
      close={() => setModal(null)} action={invite} disabled={!name.trim() || !email.includes("@")}>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus/></label>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Initial role<select value={role} onChange={(event) => setRole(event.target.value)}>
        {Object.keys(roleInfo).map((value) => <option key={value}>{value}</option>)}</select></label>
    </IdentityModal>}
    {modal === "machine" && <IdentityModal title="Add machine identity" icon={<Bot size={20}/>}
      detail="Paste only the Cloudflare Access service-token Client ID. Keep the Client Secret in your deployment secret manager."
      close={() => setModal(null)} action={addMachine} disabled={!name.trim() || !commonName.endsWith(".access")}>
      <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus/></label>
      <label>Access Client ID<input value={commonName} placeholder="…access" onChange={(event) => setCommonName(event.target.value)}/></label>
      <label>Role<select value={machineRole} onChange={(event) => setMachineRole(event.target.value as "operator" | "viewer")}>
        <option value="operator">Operator — smoke and operate</option><option value="viewer">Viewer — read only</option></select></label>
    </IdentityModal>}
    {modal === "delegation" && <IdentityModal title="Schedule approval coverage" icon={<CalendarClock size={20}/>}
      detail="Only new assignments during this window are routed. Existing review items do not move."
      close={() => setModal(null)} action={saveDelegation}
      disabled={!delegateId || !startsAt || !endsAt || delegationReason.trim().length < 5} actionLabel="Save coverage">
      <label>Covering teammate<select value={delegateId} onChange={(event) => setDelegateId(event.target.value)}>
        <option value="">Choose an approver</option>
        {members.filter((member) => member.id !== delegatingMemberId && member.status === "active" &&
          ["admin", "owner", "operator", "reviewer"].includes(member.role))
          .map((member) => <option value={member.id} key={member.id}>{member.display_name} · {member.role}</option>)}</select></label>
      <label>Starts<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/></label>
      <label>Ends<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/></label>
      <label>Reason<input value={delegationReason} maxLength={500} onChange={(event) => setDelegationReason(event.target.value)}/></label>
      <label className="coverage-toggle"><input type="checkbox" checked={delegationEnabled}
        onChange={(event) => setDelegationEnabled(event.target.checked)}/>Route new approvals during this window</label>
    </IdentityModal>}
  </section>;
}

function IdentityTable({ members, session, update }: { members: Member[]; session: SessionData | null;
  update: (id: string, body: { role?: string; status?: string }) => Promise<void> }) {
  const canManage = session?.user.role === "admin";
  return <div className="members-table panel"><div className="members-head"><span>Member</span><span>Role</span><span>Status</span><span>Last active</span></div>
    {members.map((member) => <div className="member-row" key={member.id}><span><i>{initials(member.display_name)}</i><span>
      <strong>{member.display_name}</strong><small>{member.email}{member.id === session?.user.id ? " · You" : ""}</small></span></span>
      <select value={member.role} disabled={!canManage || member.id === session?.user.id} onChange={(event) => void update(member.id, { role: event.target.value })}>
        {Object.keys(roleInfo).map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <button className={`member-status ${member.status}`} disabled={!canManage || member.id === session?.user.id}
        onClick={() => void update(member.id, { status: member.status === "active" ? "suspended" : "active" })}><i/>{member.status}</button>
      <span>{member.last_seen_at ?? "Never"}</span></div>)}</div>;
}
function IdentityModal({ title, detail, icon, close, action, disabled, children, actionLabel = "Add identity" }: { title: string; detail: string; icon: ReactNode;
  close: () => void; action: () => Promise<void>; disabled: boolean; children: ReactNode; actionLabel?: string }) {
  return <div className="mini-modal-backdrop"><div className="invite-modal"><button className="close" onClick={close}><X size={16}/></button>
    <span className="wizard-icon">{icon}</span><h2>{title}</h2><p>{detail}</p>{children}
    <button className="primary" disabled={disabled} onClick={() => void action()}><Check size={15}/>{actionLabel}</button></div></div>;
}
function initials(value: string) { return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function formatCoverage(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(value));
}
