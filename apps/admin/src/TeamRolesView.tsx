import { useEffect, useState, type ReactNode } from "react";
import { Bot, Check, LockKeyhole, Plus, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { api, type Member, type ServicePrincipal, type SessionData } from "./api";
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
  const [modal, setModal] = useState<"member" | "machine" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [commonName, setCommonName] = useState("");
  const [machineRole, setMachineRole] = useState<"operator" | "viewer">("operator");
  async function load() { try { const [people, principals] = await Promise.all([api.members(), api.servicePrincipals()]);
    setMembers(people.data); setMachines(principals.data); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load identities"); } }
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

  return <section className="team-page">
    <div className="page-title"><div><span className="eyebrow"><Users size={14}/> ORGANIZATION ACCESS</span><h1>Team & roles</h1>
      <p>Cloudflare Access verifies identity. Workrr membership controls tenant scope and application capabilities.</p></div>
      <button className="primary" onClick={() => { setName(""); setModal("member"); }}><Plus size={15}/>Add member</button></div>
    <div className="identity-boundary panel"><LockKeyhole size={20}/><span><strong>Two-layer identity boundary</strong>
      <small>Every person or machine must pass Cloudflare Access and have an active, tenant-scoped Workrr identity.</small></span>
      <span className="healthy"><i/>Enforced</span></div>
    <IdentityTable members={members} session={session} update={updateMember}/>
    <div className="machine-heading"><div><span className="eyebrow"><Bot size={14}/> MACHINE ACCESS</span><h2>Service principals</h2>
      <p>Register only an Access service-token Client ID. Workrr never receives or stores its secret.</p></div>
      <button onClick={() => { setName(""); setModal("machine"); }}><Plus size={15}/>Add machine</button></div>
    <div className="members-table panel"><div className="members-head"><span>Machine</span><span>Role</span><span>Status</span><span>Last active</span></div>
      {machines.length === 0 && <div className="machine-empty">No machine identities registered.</div>}
      {machines.map((machine) => <div className="member-row" key={machine.id}><span><i><Bot size={16}/></i><span>
        <strong>{machine.display_name}</strong><small>{machine.access_common_name}</small></span></span>
        <select value={machine.role} onChange={(event) => void updateMachine(machine.id, { role: event.target.value as "operator" | "viewer" })}>
          <option value="operator">operator</option><option value="viewer">viewer</option></select>
        <button className={`member-status ${machine.status}`} onClick={() => void updateMachine(machine.id,
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
  </section>;
}

function IdentityTable({ members, session, update }: { members: Member[]; session: SessionData | null;
  update: (id: string, body: { role?: string; status?: string }) => Promise<void> }) {
  return <div className="members-table panel"><div className="members-head"><span>Member</span><span>Role</span><span>Status</span><span>Last active</span></div>
    {members.map((member) => <div className="member-row" key={member.id}><span><i>{initials(member.display_name)}</i><span>
      <strong>{member.display_name}</strong><small>{member.email}{member.id === session?.user.id ? " · You" : ""}</small></span></span>
      <select value={member.role} disabled={member.id === session?.user.id} onChange={(event) => void update(member.id, { role: event.target.value })}>
        {Object.keys(roleInfo).map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <button className={`member-status ${member.status}`} disabled={member.id === session?.user.id}
        onClick={() => void update(member.id, { status: member.status === "active" ? "suspended" : "active" })}><i/>{member.status}</button>
      <span>{member.last_seen_at ?? "Never"}</span></div>)}</div>;
}
function IdentityModal({ title, detail, icon, close, action, disabled, children }: { title: string; detail: string; icon: ReactNode;
  close: () => void; action: () => Promise<void>; disabled: boolean; children: ReactNode }) {
  return <div className="mini-modal-backdrop"><div className="invite-modal"><button className="close" onClick={close}><X size={16}/></button>
    <span className="wizard-icon">{icon}</span><h2>{title}</h2><p>{detail}</p>{children}
    <button className="primary" disabled={disabled} onClick={() => void action()}><Check size={15}/>Add identity</button></div></div>;
}
function initials(value: string) { return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
