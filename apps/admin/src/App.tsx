import { useState } from "react";
import {
  Activity, ArrowUpRight, Bot, Boxes, Check, ChevronDown, CircleGauge, Clock3, Command,
  Database, FileCheck2, GitBranch, Inbox, Layers3, LockKeyhole, Play, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Users, Workflow, X
} from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";

const processes: AgentBlueprint[] = [
  { id: "customer-ops", name: "Customer Operations", description: "Maintains customer conversations and prepares approved business actions.", executionProfile: "conversation", modelProfile: "balanced", promptReleaseId: "prompt-customer-v1", autonomy: "approve", status: "active", tools: ["Lookup customer", "Draft reply", "Update CRM"], updatedAt: "2 min ago" },
  { id: "inbox-triage", name: "Inbox Triage", description: "Classifies incoming requests and routes work to the right owner.", executionProfile: "instant", modelProfile: "fast", promptReleaseId: "prompt-inbox-v1", autonomy: "suggest", status: "active", tools: ["Create task"], updatedAt: "18 min ago" },
  { id: "renewal-review", name: "Renewal Review", description: "Coordinates renewal research, risk scoring, brief preparation, and review.", executionProfile: "workflow", modelProfile: "reasoning", promptReleaseId: "prompt-renewal-v1", autonomy: "approve", status: "testing", tools: ["Lookup contract", "Score risk", "Draft brief"], updatedAt: "Yesterday" }
];

const nav = [
  ["Overview", CircleGauge], ["Processes", Workflow], ["Work inbox", Inbox], ["Activity", Activity],
  ["Connections", Boxes], ["Knowledge", Database], ["Evaluations", FileCheck2], ["Governance", ShieldCheck]
] as const;

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}><span />{value}</span>;
}

export function App() {
  const [active, setActive] = useState("Overview");
  const [selected, setSelected] = useState<AgentBlueprint | null>(null);
  const [search, setSearch] = useState("");
  const filtered = processes.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brandmark"><Command size={18} /></span><div><strong>workrr</strong><small>PRIVATE AI OPERATIONS</small></div></div>
      <div className="workspace"><span className="avatar">A</span><div><strong>Acme Operations</strong><small>Dedicated environment</small></div><ChevronDown size={15} /></div>
      <nav>{nav.map(([label, Icon]) => <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}><Icon size={18} />{label}{label === "Work inbox" && <em>3</em>}</button>)}</nav>
      <div className="aside-bottom"><div className="private"><LockKeyhole size={16}/><div><strong>Private by design</strong><small>Cloudflare dedicated</small></div></div><button><Settings2 size={17}/>Settings</button><button><Users size={17}/>Team & roles</button></div>
    </aside>

    <main>
      <header><div className="crumb">OPERATIONS <span>/</span> OVERVIEW</div><div className="header-actions"><button className="search"><Search size={17}/>Search <kbd>⌘ K</kbd></button><button className="icon-button"><Inbox size={17}/><i /></button><div className="user">SB</div></div></header>
      <div className="content">
        <section className="hero"><div><div className="eyebrow"><Sparkles size={14}/> YOUR AI OPERATIONS</div><h1>Good morning, Shawn.</h1><p>Three processes are working across your organization. One item needs your review.</p></div><button className="primary"><Plus size={17}/>Create process</button></section>

        <section className="metrics">
          <article><div><span className="metric-icon green"><Bot size={18}/></span><small>ACTIVE PROCESSES</small></div><strong>3</strong><p><b>+1</b> this month</p></article>
          <article><div><span className="metric-icon amber"><Clock3 size={18}/></span><small>NEEDS REVIEW</small></div><strong>1</strong><p>Oldest waiting <b className="amber-text">14 min</b></p></article>
          <article><div><span className="metric-icon blue"><Activity size={18}/></span><small>RUNS · 7 DAYS</small></div><strong>1,284</strong><p><b>↗ 18%</b> from last week</p></article>
          <article><div><span className="metric-icon violet"><Layers3 size={18}/></span><small>TIME RETURNED</small></div><strong>41.2h</strong><p>Estimated this week</p></article>
        </section>

        <section className="grid-main">
          <div className="panel processes">
            <div className="panel-head"><div><h2>AI processes</h2><p>Live operational capabilities, not generic bots.</p></div><button className="quiet">View all <ArrowUpRight size={15}/></button></div>
            <div className="filter"><Search size={16}/><input aria-label="Search processes" placeholder="Find a process" value={search} onChange={(e) => setSearch(e.target.value)}/><button><Settings2 size={15}/>Filter</button></div>
            <div className="process-list">{filtered.map((process) => <button className="process-row" key={process.id} onClick={() => setSelected(process)}>
              <span className={`process-icon ${process.executionProfile}`}><Workflow size={19}/></span>
              <span className="process-copy"><span><strong>{process.name}</strong><Status value={process.status}/></span><small>{process.description}</small><span className="tags"><i>{process.executionProfile.replace("_", " ")}</i><i>{process.modelProfile}</i><i>{process.autonomy}</i></span></span>
              <span className="process-stat"><small>RUNS · 7D</small><strong>{process.id === "customer-ops" ? "642" : process.id === "inbox-triage" ? "511" : "131"}</strong></span>
              <ArrowUpRight size={17}/>
            </button>)}</div>
          </div>

          <div className="side-stack">
            <div className="panel approval-card"><div className="panel-head"><div><h2>Review queue</h2><p>Human control points</p></div><span className="count">1</span></div><div className="approval"><div className="approval-top"><span className="company">NC</span><div><strong>Renewal outreach</strong><small>Northstar Components</small></div><span>14m</span></div><p>Customer Operations wants to send a renewal summary to the account owner.</p><div className="risk"><ShieldCheck size={15}/><span><strong>Medium impact</strong><small>External communication · reversible</small></span></div><div className="approval-actions"><button><X size={16}/>Decline</button><button className="approve"><Check size={16}/>Approve</button></div></div><button className="full-link">Open work inbox <ArrowUpRight size={15}/></button></div>
            <div className="panel health"><div className="panel-head"><div><h2>Platform health</h2><p>Dedicated Cloudflare environment</p></div><span className="healthy"><i/>Healthy</span></div><div className="health-row"><span><Activity size={16}/>Success rate</span><strong>99.4%</strong></div><div className="health-row"><span><Clock3 size={16}/>p95 response</span><strong>1.8s</strong></div><div className="health-row"><span><GitBranch size={16}/>Durable workflows</span><strong>8 running</strong></div><div className="health-row"><span><Database size={16}/>Data boundary</span><strong>Private</strong></div></div>
          </div>
        </section>
      </div>
    </main>

    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="drawer" onClick={(e) => e.stopPropagation()}><button className="close" onClick={() => setSelected(null)}><X/></button><span className={`process-icon large ${selected.executionProfile}`}><Workflow/></span><Status value={selected.status}/><h2>{selected.name}</h2><p>{selected.description}</p><div className="detail-grid"><span><small>EXECUTION</small><strong>{selected.executionProfile}</strong></span><span><small>AUTONOMY</small><strong>{selected.autonomy}</strong></span><span><small>MODEL PROFILE</small><strong>{selected.modelProfile}</strong></span><span><small>PROMPT RELEASE</small><strong>v1 · published</strong></span></div><h3>Authorized capabilities</h3><div className="tool-list">{selected.tools.map((tool) => <span key={tool}><Check size={15}/>{tool}</span>)}</div><button className="primary run"><Play size={17}/>Run in test mode</button><button className="secondary">Open Process Studio</button></aside></div>}
  </div>;
}
