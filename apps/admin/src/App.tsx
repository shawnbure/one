import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  CircleGauge,
  Clock3,
  Command,
  Database,
  FileCheck2,
  GitBranch,
  Inbox,
  Layers3,
  LockKeyhole,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X,
  Code2,
} from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import {
  api,
  ApiError,
  type Approval,
  type OverviewData,
  type SessionData,
  type ValueData,
} from "./api";
import "./live.css";
import "./wizard.css";
import "./team.css";
import "./export.css";
import "./readability.css";
import "./setup.css";
import "./notifications.css";
import { WorkInbox } from "./WorkInbox";
import { ActivityView } from "./ActivityView";
import { ProcessStudioView } from "./ProcessStudioView";
import { FoundationView } from "./FoundationViews";
import { ApiLogsView } from "./ApiLogsView";
import { CreateProcessWizard } from "./CreateProcessWizard";
import { TeamRolesView } from "./TeamRolesView";
import { CustomerSetupView } from "./CustomerSetupView";
import { NotificationsView } from "./NotificationsView";

const previewProcesses: AgentBlueprint[] = [
  {
    id: "customer-ops",
    name: "Customer Operations",
    description:
      "Maintains customer conversations and prepares approved business actions.",
    executionProfile: "conversation",
    modelProfile: "balanced",
    promptReleaseId: "prompt-customer-v1",
    autonomy: "approve",
    status: "active",
    tools: ["Lookup customer", "Draft reply", "Update CRM"],
    updatedAt: "2 min ago",
  },
  {
    id: "inbox-triage",
    name: "Inbox Triage",
    description:
      "Classifies incoming requests and routes work to the right owner.",
    executionProfile: "instant",
    modelProfile: "fast",
    promptReleaseId: "prompt-inbox-v1",
    autonomy: "suggest",
    status: "active",
    tools: ["Create task"],
    updatedAt: "18 min ago",
  },
  {
    id: "renewal-review",
    name: "Renewal Review",
    description:
      "Coordinates renewal research, risk scoring, brief preparation, and review.",
    executionProfile: "workflow",
    modelProfile: "reasoning",
    promptReleaseId: "prompt-renewal-v1",
    autonomy: "approve",
    status: "testing",
    tools: ["Lookup contract", "Score risk", "Draft brief"],
    updatedAt: "Yesterday",
  },
];

const nav = [
  ["Overview", CircleGauge],
  ["Processes", Workflow],
  ["Work inbox", Inbox],
  ["Activity", Activity],
  ["API logs", Code2],
  ["Connections", Boxes],
  ["Knowledge", Database],
  ["Evaluations", FileCheck2],
  ["Governance", ShieldCheck],
  ["Notifications", Bell],
] as const;

function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value}`}>
      <span />
      {value}
    </span>
  );
}

export function App() {
  const [active, setActive] = useState("Overview");
  const [selected, setSelected] = useState<AgentBlueprint | null>(null);
  const [search, setSearch] = useState("");
  const [processes, setProcesses] =
    useState<AgentBlueprint[]>(previewProcesses);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [session, setSession] = useState<SessionData | null>(null);
  const [value, setValue] = useState<ValueData | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [runInput, setRunInput] = useState("");
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [studioProcessId, setStudioProcessId] = useState<string | null>(null);
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      processes.filter((p) =>
        `${p.name} ${p.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [processes, search],
  );
  const pending = approvals.find((item) => item.status === "pending");

  async function refresh() {
    try {
      const [sessionResult, processResult, overviewResult, approvalResult, valueResult] =
        await Promise.all([
          api.session(),
          api.processes(),
          api.overview(),
          api.approvals(),
          api.value(),
        ]);
      setSession(sessionResult);
      setProcesses(processResult.data);
      setOverview(overviewResult);
      setApprovals(approvalResult.data);
      setValue(valueResult.data);
      setPreviewMode(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        setPreviewMode(true);
      else
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not load operations data",
        );
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    setNotice(null);
    try {
      const result = await api.decideApproval(id, decision);
      if (!result.updated)
        throw new Error("This review item was already resolved");
      setNotice(
        decision === "approved"
          ? "Action approved and recorded."
          : "Action declined and recorded.",
      );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  }

  async function runSelected() {
    if (!selected || !runInput.trim()) return;
    setBusy(selected.id);
    setRunOutput(null);
    try {
      const result = await api.execute({
        blueprintId: selected.id,
        input: runInput.trim(),
        threadId:
          selected.executionProfile === "conversation"
            ? `console-${selected.id}`
            : undefined,
        consumerId:
          selected.executionProfile === "consumer" ? "console-user" : undefined,
        entityId:
          selected.executionProfile === "entity" ? "console-entity" : undefined,
        shardKey:
          selected.executionProfile === "shared_shard" ? "console" : undefined,
      });
      setRunOutput(
        result.output ??
          `Run ${result.status}. Execution ${result.executionId.slice(0, 8)} is now processing.`,
      );
      await refresh();
    } catch (error) {
      setRunOutput(error instanceof Error ? error.message : "Run failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="brandmark">
            <Command size={18} />
          </span>
          <div>
            <strong>workrr</strong>
            <small>PRIVATE AI OPERATIONS</small>
          </div>
        </div>
        <div className="workspace">
          <span className="avatar">A</span>
          <div>
            <strong>{session?.tenantName ?? "Customer environment"}</strong>
            <small>Dedicated environment</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={active === label ? "active" : ""}
              onClick={() => {
                setActive(label);
                if (label === "Processes") setStudioProcessId(null);
              }}
            >
              <Icon size={18} />
              {label}
              {label === "Work inbox" &&
                (overview?.pendingApprovals ?? 0) > 0 && (
                  <em>{overview?.pendingApprovals}</em>
                )}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="private">
            <LockKeyhole size={16} />
            <div>
              <strong>Private by design</strong>
              <small>Cloudflare dedicated</small>
            </div>
          </div>
          <button onClick={() => setActive("Governance")}>
            <Settings2 size={17} />
            Settings
          </button>
          <button onClick={() => setActive("Customer setup")}>
            <Settings2 size={17} />
            Customer setup
          </button>
          <button onClick={() => setActive("Team & roles")}>
            <Users size={17} />
            Team & roles
          </button>
        </div>
      </aside>

      <main>
        <header>
          <div className="crumb">
            OPERATIONS <span>/</span> {active.toUpperCase()}
          </div>
          <div className="header-actions">
            <button className="search">
              <Search size={17} />
              Search <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button"
              onClick={() => setActive("Work inbox")}
            >
              <Inbox size={17} />
              {(overview?.pendingApprovals ?? 0) > 0 && <i />}
            </button>
            <div className="user">
              {session?.user.name
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() ?? "SB"}
            </div>
          </div>
        </header>
        <div className="content">
          {previewMode && (
            <div className="environment-banner">
              <LockKeyhole size={15} />
              <span>
                <strong>Secure preview</strong> Live operations unlock after
                identity is connected.
              </span>
            </div>
          )}
          {notice && (
            <button className="notice" onClick={() => setNotice(null)}>
              {notice}
              <X size={14} />
            </button>
          )}
          {active === "Notifications" ? (
            <NotificationsView onNotice={setNotice} />
          ) : active === "Customer setup" ? (
            <CustomerSetupView session={session} onNotice={setNotice} />
          ) : active === "Team & roles" ? (
            <TeamRolesView session={session} onNotice={setNotice} />
          ) : active === "Work inbox" ? (
            <WorkInbox
              items={approvals}
              session={session}
              onRefresh={refresh}
              onNotice={setNotice}
            />
          ) : active === "Activity" ? (
            <ActivityView processes={processes} onNotice={setNotice} />
          ) : active === "API logs" ? (
            <ApiLogsView onNotice={setNotice} />
          ) : active === "Processes" ? (
            <ProcessStudioView
              processId={studioProcessId}
              processes={processes}
              onSelect={setStudioProcessId}
              onNotice={setNotice}
              onCreate={() => setCreatingProcess(true)}
            />
          ) : [
              "Connections",
              "Knowledge",
              "Evaluations",
              "Governance",
            ].includes(active) ? (
            <FoundationView
              section={
                active as
                  | "Connections"
                  | "Knowledge"
                  | "Evaluations"
                  | "Governance"
              }
              onNotice={setNotice}
            />
          ) : (
            <>
              <section className="hero">
                <div>
                  <div className="eyebrow">
                    <Sparkles size={14} /> YOUR AI OPERATIONS
                  </div>
                  <h1>
                    Good morning, {session?.user.name.split(" ")[0] ?? "Shawn"}.
                  </h1>
                  <p>
                    {processes.length} processes are configured across your
                    organization. {overview?.pendingApprovals ?? 1} item needs
                    review.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setCreatingProcess(true)}
                >
                  <Plus size={17} />
                  Create process
                </button>
              </section>

              <section className="metrics">
                <article>
                  <div>
                    <span className="metric-icon green">
                      <Bot size={18} />
                    </span>
                    <small>ACTIVE PROCESSES</small>
                  </div>
                  <strong>{overview?.activeProcesses ?? 3}</strong>
                  <p>
                    <b>{processes.length}</b> configured
                  </p>
                </article>
                <article>
                  <div>
                    <span className="metric-icon amber">
                      <Clock3 size={18} />
                    </span>
                    <small>NEEDS REVIEW</small>
                  </div>
                  <strong>{overview?.pendingApprovals ?? 1}</strong>
                  <p>
                    {pending ? "Human decision required" : "Queue is clear"}
                  </p>
                </article>
                <article>
                  <div>
                    <span className="metric-icon blue">
                      <Activity size={18} />
                    </span>
                    <small>RUNS · 7 DAYS</small>
                  </div>
                  <strong>{(overview?.runs7d ?? 1284).toLocaleString()}</strong>
                  <p>
                    <b>
                      {overview
                        ? `${overview.completed7d} completed`
                        : "↗ 18%"}
                    </b>
                    {overview
                      ? ` · ${overview.failed7d} failed`
                      : " from last week"}
                  </p>
                </article>
                <article>
                  <div>
                    <span className="metric-icon violet">
                      <Layers3 size={18} />
                    </span>
                    <small>TIME RETURNED</small>
                  </div>
                  <strong>{value ? `${(value.totals.human_minutes_saved / 60).toFixed(1)}h` : "41.2h"}</strong>
                  <p>{value ? `$${value.totals.estimated_value.toLocaleString()} estimated value` : "Estimated this week"}</p>
                </article>
              </section>

              <section className="grid-main">
                <div className="panel processes">
                  <div className="panel-head">
                    <div>
                      <h2>AI processes</h2>
                      <p>Live operational capabilities, not generic bots.</p>
                    </div>
                    <button className="quiet">
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="filter">
                    <Search size={16} />
                    <input
                      aria-label="Search processes"
                      placeholder="Find a process"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <button>
                      <Settings2 size={15} />
                      Filter
                    </button>
                  </div>
                  <div className="process-list">
                    {filtered.map((process) => (
                      <button
                        className="process-row"
                        key={process.id}
                        onClick={() => setSelected(process)}
                      >
                        <span
                          className={`process-icon ${process.executionProfile}`}
                        >
                          <Workflow size={19} />
                        </span>
                        <span className="process-copy">
                          <span>
                            <strong>{process.name}</strong>
                            <Status value={process.status} />
                          </span>
                          <small>{process.description}</small>
                          <span className="tags">
                            <i>{process.executionProfile.replace("_", " ")}</i>
                            <i>{process.modelProfile}</i>
                            <i>{process.autonomy}</i>
                          </span>
                        </span>
                        <span className="process-stat">
                          <small>RUNS · 7D</small>
                          <strong>
                            {overview?.processRuns[process.id] ??
                              (process.id === "customer-ops"
                                ? "642"
                                : process.id === "inbox-triage"
                                  ? "511"
                                  : "131")}
                          </strong>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="side-stack">
                  <div className="panel approval-card">
                    <div className="panel-head">
                      <div>
                        <h2>Review queue</h2>
                        <p>Human control points</p>
                      </div>
                      <span className="count">
                        {overview?.pendingApprovals ?? 1}
                      </span>
                    </div>
                    {pending ? (
                      <div className="approval">
                        <div className="approval-top">
                          <span className="company">AI</span>
                          <div>
                            <strong>
                              {pending.action_name.replaceAll("_", " ")}
                            </strong>
                            <small>
                              Execution {pending.execution_id.slice(0, 8)}
                            </small>
                          </div>
                          <span>New</span>
                        </div>
                        <p>
                          An AI process is waiting for authorization before it
                          performs this action.
                        </p>
                        <div className="risk">
                          <ShieldCheck size={15} />
                          <span>
                            <strong>Human checkpoint</strong>
                            <small>Consequential action · audited</small>
                          </span>
                        </div>
                        <div className="approval-actions">
                          <button
                            disabled={busy === pending.id}
                            onClick={() => void decide(pending.id, "rejected")}
                          >
                            <X size={16} />
                            Decline
                          </button>
                          <button
                            disabled={busy === pending.id}
                            className="approve"
                            onClick={() => void decide(pending.id, "approved")}
                          >
                            <Check size={16} />
                            Approve
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-approval">
                        <ShieldCheck size={24} />
                        <strong>No work waiting</strong>
                        <span>Human checkpoints will appear here.</span>
                      </div>
                    )}
                    <button className="full-link">
                      Open work inbox <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="panel health">
                    <div className="panel-head">
                      <div>
                        <h2>Platform health</h2>
                        <p>Dedicated Cloudflare environment</p>
                      </div>
                      <span className="healthy">
                        <i />
                        Healthy
                      </span>
                    </div>
                    <div className="health-row">
                      <span>
                        <Activity size={16} />
                        Success rate
                      </span>
                      <strong>99.4%</strong>
                    </div>
                    <div className="health-row">
                      <span>
                        <Clock3 size={16} />
                        p95 response
                      </span>
                      <strong>1.8s</strong>
                    </div>
                    <div className="health-row">
                      <span>
                        <GitBranch size={16} />
                        Durable workflows
                      </span>
                      <strong>8 running</strong>
                    </div>
                    <div className="health-row">
                      <span>
                        <Database size={16} />
                        Data boundary
                      </span>
                      <strong>Private</strong>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {creatingProcess && (
        <CreateProcessWizard
          onClose={() => setCreatingProcess(false)}
          onNotice={setNotice}
          onCreated={async (id) => {
            setCreatingProcess(false);
            await refresh();
            setStudioProcessId(id);
            setActive("Processes");
          }}
        />
      )}

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>
              <X />
            </button>
            <span className={`process-icon large ${selected.executionProfile}`}>
              <Workflow />
            </span>
            <Status value={selected.status} />
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
            <div className="detail-grid">
              <span>
                <small>EXECUTION</small>
                <strong>{selected.executionProfile}</strong>
              </span>
              <span>
                <small>AUTONOMY</small>
                <strong>{selected.autonomy}</strong>
              </span>
              <span>
                <small>MODEL PROFILE</small>
                <strong>{selected.modelProfile}</strong>
              </span>
              <span>
                <small>PROMPT RELEASE</small>
                <strong>{selected.promptReleaseId}</strong>
              </span>
            </div>
            <h3>Authorized capabilities</h3>
            <div className="tool-list">
              {selected.tools.map((tool) => (
                <span key={tool}>
                  <Check size={15} />
                  {tool.replaceAll("_", " ")}
                </span>
              ))}
            </div>
            <h3 className="test-label">Test this process</h3>
            <textarea
              className="run-input"
              placeholder="Describe the work you want this process to handle…"
              value={runInput}
              onChange={(event) => setRunInput(event.target.value)}
            />
            {runOutput && (
              <div className="run-output">
                <Sparkles size={15} />
                <span>{runOutput}</span>
              </div>
            )}
            <button
              disabled={previewMode || busy === selected.id || !runInput.trim()}
              className="primary run"
              onClick={() => void runSelected()}
            >
              <Play size={17} />
              {busy === selected.id
                ? "Running…"
                : previewMode
                  ? "Identity required"
                  : "Run in test mode"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setStudioProcessId(selected.id);
                setActive("Processes");
                setSelected(null);
              }}
            >
              Open Process Studio
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
