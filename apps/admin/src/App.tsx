import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
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
  CircleDollarSign,
  TrendingUp,
  Lightbulb,
  BookOpen,
  Menu,
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
import { CommandCenter } from "./CommandCenter";
import { AccountMenu } from "./AccountMenu";
import { authorizedWorkspaceLabels, processVisibleInCommands, type CommandSearchItem } from "./command-search";
import { startupRoute } from "./startup-route";
import "./live.css";
import "./wizard.css";
import "./wizard-readability.css";
import "./team.css";
import "./export.css";
import "./setup.css";
import "./notifications.css";
import "./usage.css";
import "./execution-explainer.css";
import "./memory-governance.css";
import "./model-policy.css";
import "./actor-local-work.css";
import "./actor-release.css";
import "./actor-adoption.css";
import "./recovery.css";

const WorkInbox = lazy(() =>
  import("./WorkInbox").then(({ WorkInbox }) => ({ default: WorkInbox })),
);
const ActivityView = lazy(() =>
  import("./ActivityView").then(({ ActivityView }) => ({ default: ActivityView })),
);
const ProcessStudioView = lazy(() =>
  import("./ProcessStudioView").then(({ ProcessStudioView }) => ({
    default: ProcessStudioView,
  })),
);
const FoundationView = lazy(() =>
  import("./FoundationViews").then(({ FoundationView }) => ({
    default: FoundationView,
  })),
);
const ApiLogsView = lazy(() =>
  import("./ApiLogsView").then(({ ApiLogsView }) => ({ default: ApiLogsView })),
);
const CreateProcessWizard = lazy(() =>
  import("./CreateProcessWizard").then(({ CreateProcessWizard }) => ({
    default: CreateProcessWizard,
  })),
);
const TeamRolesView = lazy(() =>
  import("./TeamRolesView").then(({ TeamRolesView }) => ({
    default: TeamRolesView,
  })),
);
const CustomerSetupView = lazy(() =>
  import("./CustomerSetupView").then(({ CustomerSetupView }) => ({
    default: CustomerSetupView,
  })),
);
const NotificationsView = lazy(() =>
  import("./NotificationsView").then(({ NotificationsView }) => ({
    default: NotificationsView,
  })),
);
const UsageView = lazy(() =>
  import("./UsageView").then(({ UsageView }) => ({ default: UsageView })),
);
const ValuePortfolioView = lazy(() =>
  import("./ValuePortfolioView").then(({ ValuePortfolioView }) => ({ default: ValuePortfolioView })),
);
const OpportunitiesView = lazy(() =>
  import("./OpportunitiesView").then(({ OpportunitiesView }) => ({
    default: OpportunitiesView,
  })),
);
const HelpCenterView = lazy(() =>
  import("./HelpCenterView").then(({ HelpCenterView }) => ({
    default: HelpCenterView,
  })),
);
const ProcessLaunchpadView = lazy(() =>
  import("./ProcessLaunchpadView").then(({ ProcessLaunchpadView }) => ({
    default: ProcessLaunchpadView,
  })),
);

function FeatureLoading({ label }: { label: string }) {
  return (
    <section className="feature-loading" role="status" aria-live="polite">
      <span className="feature-loading-mark" aria-hidden="true" />
      <div>
        <strong>Opening {label}</strong>
        <p>Loading this workspace securely…</p>
      </div>
    </section>
  );
}

class FeatureBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "This workspace could not be loaded.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Admin feature failed to load", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="feature-load-error" role="alert">
          <strong>This workspace did not load</strong>
          <p>
            Your session is still active. Reload the application to request the
            workspace again.
          </p>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

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
  ["Launchpad", Sparkles],
  ["Processes", Workflow],
  ["Opportunities", Lightbulb],
  ["Work inbox", Inbox],
  ["Activity", Activity],
  ["API logs", Code2],
  ["Connections", Boxes],
  ["Knowledge", Database],
  ["Evaluations", FileCheck2],
  ["Governance", ShieldCheck],
  ["Notifications", Bell],
  ["Value & decisions", TrendingUp],
  ["Usage & budgets", CircleDollarSign],
] as const;

const workspaceSearch: Record<string, { description: string; keywords: string[] }> = {
  Overview: { description: "Operational health, value, and work requiring attention", keywords: ["home", "health", "value"] },
  Launchpad: { description: "Run approved employee AI processes and private conversations", keywords: ["employee", "chat", "run"] },
  Processes: { description: "Design, test, publish, pause, and roll back AI processes", keywords: ["studio", "agents", "releases"] },
  Opportunities: { description: "Discover and qualify manual work for AI implementation", keywords: ["discovery", "intake", "manual"] },
  "Work inbox": { description: "Review approvals, assignments, and waiting actions", keywords: ["approval", "review", "waiting"] },
  Activity: { description: "Inspect executions, evidence, failures, and recovery", keywords: ["runs", "timeline", "errors"] },
  "API logs": { description: "Trace retained webhook and provider request metadata", keywords: ["webhooks", "http", "integration"] },
  Connections: { description: "Manage provider credentials, typed tools, and acceptance", keywords: ["oauth", "microsoft", "tools"] },
  Knowledge: { description: "Govern customer documents, retrieval, and citations", keywords: ["r2", "vectorize", "documents"] },
  Evaluations: { description: "Run release gates, regression suites, and model trials", keywords: ["tests", "quality", "golden"] },
  Governance: { description: "Control privacy, memory, incidents, retention, and deployment", keywords: ["security", "privacy", "controls"] },
  "Value & decisions": { description: "Decide where to expand, correct, observe, or retire AI processes", keywords: ["executive", "portfolio", "value", "roi"] },
  Notifications: { description: "Configure accountable in-app, email, and webhook delivery", keywords: ["alerts", "email", "digest"] },
  "Usage & budgets": { description: "Review model cost, tokens, limits, and reconciliation", keywords: ["cost", "billing", "tokens"] },
  "Customer setup": { description: "Provision, measure, and hand off the customer environment", keywords: ["deployment", "onboarding", "fde"] },
  "Team & roles": { description: "Manage tenant members, roles, and service principals", keywords: ["rbac", "members", "access"] },
  "Help Center": { description: "Open role-specific guidance, runbooks, and support requests", keywords: ["docs", "training", "support"] },
};

function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value}`}>
      <span />
      {value}
    </span>
  );
}

export function App() {
  const startup = useMemo(() => startupRoute(window.location.search), []);
  const initialProcessId = startup.processId;
  const focusedLaunchpad = startup.focusedLaunchpad;
  const [active, setActive] = useState<string>(startup.workspace);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const [launchpadProcessId, setLaunchpadProcessId] = useState<string | null>(initialProcessId);
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
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
  const consumerView = session?.user.role === "consumer";
  const visibleNav = consumerView
    ? nav.filter(([label]) => label === "Overview" || label === "Launchpad")
    : nav;
  const commandItems = useMemo<CommandSearchItem[]>(() => {
    const workspaceLabels = authorizedWorkspaceLabels(consumerView);
    const workspaces = workspaceLabels.map((label) => ({
      id: `workspace:${label}`,
      label,
      description: workspaceSearch[label]?.description ?? "Open this Workrr workspace",
      keywords: workspaceSearch[label]?.keywords ?? [],
      kind: "workspace" as const,
      target: label,
    }));
    const authorizedProcesses = processes.filter((process) => processVisibleInCommands(process, consumerView));
    return [...workspaces, ...authorizedProcesses.map((process) => ({
      id: `process:${process.id}`,
      label: process.name,
      description: process.description || `${process.executionProfile} AI process`,
      keywords: [process.executionProfile, process.status, process.autonomy, process.modelProfile],
      kind: "process" as const,
      target: process.id,
    }))];
  }, [consumerView, processes]);

  async function refresh() {
    try {
      const sessionResult = await api.session();
      const restrictedConsumer = sessionResult.user.role === "consumer";
      const [processResult, overviewResult, approvalResult, valueResult] =
        await Promise.all([
          api.processes(),
          restrictedConsumer ? Promise.resolve(null) : api.overview(),
          restrictedConsumer ? Promise.resolve({ data: [] as Approval[] }) : api.approvals(),
          restrictedConsumer ? Promise.resolve({ data: null }) : api.value(),
        ]);
      setSession(sessionResult);
      setProcesses(processResult.data);
      setOverview(overviewResult);
      setApprovals(approvalResult.data);
      setValue(valueResult.data);
      if (restrictedConsumer) setActive((current) => current === "Overview" ? "Launchpad" : current);
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
    if (startup.notice) setNotice(startup.notice);
    if (startup.consumesReturnState) {
      window.history.replaceState({}, "", `${window.location.pathname}${startup.anchor ?? ""}`);
    }
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function chooseCommand(item: CommandSearchItem) {
    if (item.kind === "workspace") {
      setActive(item.target);
      if (item.target === "Processes") setStudioProcessId(null);
      return;
    }
    if (consumerView) {
      setLaunchpadProcessId(item.target);
      setActive("Launchpad");
    } else {
      setStudioProcessId(item.target);
      setActive("Processes");
    }
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    setNotice(null);
    try {
      const approval = approvals.find((item) => item.id === id);
      if (!approval) throw new Error("Review item is no longer available");
      const result = await api.decideApproval(id, decision, approval.revision);
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
          (result.status === "waiting_approval"
            ? `Proposal created. Execution ${result.executionId.slice(0, 8)} is waiting in the Work Inbox.`
            : `Run ${result.status}. Execution ${result.executionId.slice(0, 8)} is now processing.`),
      );
      await refresh();
    } catch (error) {
      setRunOutput(error instanceof Error ? error.message : "Run failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`shell${focusedLaunchpad ? " focused-launchpad" : ""}`}>
      <CommandCenter open={commandOpen} items={commandItems}
        onClose={() => setCommandOpen(false)} onChoose={chooseCommand}/>
      <aside className={mobileNavOpen ? "mobile-open" : ""}>
        <div className="brand">
          <span className="brandmark">
            <Command size={18} />
          </span>
          <div>
            <strong>workrr</strong>
            <small>PRIVATE AI OPERATIONS</small>
          </div>
          <button className="mobile-nav-toggle" type="button"
            aria-expanded={mobileNavOpen} aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileNavOpen((open) => !open)}>
            {mobileNavOpen ? <X size={20}/> : <Menu size={20}/>}
          </button>
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
          {visibleNav.map(([label, Icon]) => (
            <button
              key={label}
              className={active === label ? "active" : ""}
              onClick={() => {
                setActive(label);
                setMobileNavOpen(false);
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
          {!consumerView && <>
            <button onClick={() => { setActive("Governance"); setMobileNavOpen(false); }}>
              <Settings2 size={17} />
              Settings
            </button>
            <button onClick={() => { setActive("Customer setup"); setMobileNavOpen(false); }}>
              <Settings2 size={17} />
              Customer setup
            </button>
            <button onClick={() => { setActive("Team & roles"); setMobileNavOpen(false); }}>
              <Users size={17} />
              Team & roles
            </button>
          </>}
          <button onClick={() => { setActive("Help Center"); setMobileNavOpen(false); }}>
            <BookOpen size={17} />
            Help Center
          </button>
        </div>
      </aside>

      <main>
        <header>
          <div className="crumb">
            OPERATIONS <span>/</span> {active.toUpperCase()}
          </div>
          <div className="header-actions">
            <button className="search" aria-haspopup="dialog" onClick={() => setCommandOpen(true)}>
              <Search size={17} />
              Search <kbd>⌘ K</kbd>
            </button>
            {!consumerView && <button
              className="icon-button"
              onClick={() => setActive("Work inbox")}
            >
              <Inbox size={17} />
              {(overview?.pendingApprovals ?? 0) > 0 && <i />}
            </button>}
            <AccountMenu session={session} />
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
          <FeatureBoundary key={`${active}:${active === "Launchpad" ? launchpadProcessId ?? "" : ""}`}>
            <Suspense fallback={<FeatureLoading label={active} />}>
          {active === "Launchpad" ? (
            <ProcessLaunchpadView
              processes={processes}
              session={session}
              initialProcessId={launchpadProcessId}
              focused={focusedLaunchpad}
              onNotice={setNotice}
            />
          ) : active === "Usage & budgets" ? (
            <UsageView session={session} onNotice={setNotice} />
          ) : active === "Value & decisions" ? (
            <ValuePortfolioView session={session} onNotice={setNotice} onOpenProcess={(id) => {
              setStudioProcessId(id); setActive("Processes");
            }}/>
          ) : active === "Notifications" ? (
            <NotificationsView session={session} onNotice={setNotice}
              onOpenValue={() => setActive("Value & decisions")}
              onOpenSetup={() => setActive("Customer setup")}
              onOpenUsage={() => setActive("Usage & budgets")} />
          ) : active === "Customer setup" ? (
            <CustomerSetupView session={session} onNotice={setNotice} />
          ) : active === "Team & roles" ? (
            <TeamRolesView session={session} onNotice={setNotice} />
          ) : active === "Help Center" ? (
            <HelpCenterView session={session} onNotice={setNotice} />
          ) : active === "Work inbox" ? (
            <WorkInbox
              items={approvals}
              session={session}
              onRefresh={refresh}
              onNotice={setNotice}
            />
          ) : active === "Activity" ? (
            <ActivityView processes={processes} session={session} onNotice={setNotice} />
          ) : active === "API logs" ? (
            <ApiLogsView onNotice={setNotice} />
          ) : active === "Processes" ? (
            <ProcessStudioView
              processId={studioProcessId}
              processes={processes}
              session={session}
              onSelect={setStudioProcessId}
              onNotice={setNotice}
              onCreate={() => setCreatingProcess(true)}
              onRefresh={refresh}
            />
          ) : active === "Opportunities" ? (
            <OpportunitiesView session={session} onNotice={setNotice} onProcessCreated={async (id) => {
              await refresh(); setStudioProcessId(id); setActive("Processes");
            }}/>
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
              session={session}
              onNotice={setNotice}
              onNavigate={setActive}
            />
          ) : (
            <>
              <section className="hero">
                <div>
                  <div className="eyebrow">
                    <Sparkles size={14} /> YOUR AI OPERATIONS
                  </div>
                  <h1>
                    Good morning, {session?.user.name.split(" ")[0] ?? "there"}.
                  </h1>
                  <p>
                    {processes.length} processes are configured across your
                    organization. {overview?.pendingApprovals ?? 0} item needs
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
                  <strong>{overview?.activeProcesses ?? "—"}</strong>
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
                  <strong>{overview?.pendingApprovals ?? "—"}</strong>
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
                  <strong>{overview ? overview.runs7d.toLocaleString() : "—"}</strong>
                  <p>
                    <b>
                      {overview ? `${overview.completed7d} completed` : "Loading evidence"}
                    </b>
                      {overview ? ` · ${overview.failed7d} failed` : ""}
                  </p>
                </article>
                <article>
                  <div>
                    <span className="metric-icon violet">
                      <Layers3 size={18} />
                    </span>
                    <small>TIME RETURNED</small>
                  </div>
                  <strong>{value ? `${(value.totals.human_minutes_saved / 60).toFixed(1)}h` : "—"}</strong>
                  <p>{value ? `$${value.totals.estimated_value.toLocaleString()} estimated value` : "Loading evidence"}</p>
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
                            {overview ? (overview.processRuns[process.id] ?? 0).toLocaleString() : "—"}
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
                        {overview?.pendingApprovals ?? "—"}
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
                      <span className={overview?.operationalHealth.status === "attention" ? "attention-badge" : "healthy"}>
                        <i />
                        {overview?.operationalHealth.status === "healthy" ? "Healthy" :
                          overview?.operationalHealth.status === "attention" ? "Needs attention" : "Awaiting evidence"}
                      </span>
                    </div>
                    <div className="health-row">
                      <span title={overview ? `${overview.operationalHealth.terminalRuns} terminal runs in the last 7 days` : undefined}>
                        <Activity size={16} />
                        Success rate
                      </span>
                      <strong>{overview?.operationalHealth.successRate == null ? "—" :
                        `${overview.operationalHealth.successRate.toFixed(1)}%`}</strong>
                    </div>
                    <div className="health-row">
                      <span title={overview ? `${overview.operationalHealth.latencySamples} completed runs in the p95 sample` : undefined}>
                        <Clock3 size={16} />
                        p95 response
                      </span>
                      <strong>{formatLatency(overview?.operationalHealth.p95ResponseMs ?? null)}</strong>
                    </div>
                    <div className="health-row">
                      <span>
                        <GitBranch size={16} />
                        Durable work
                      </span>
                      <strong>{overview ? `${overview.operationalHealth.activeDurableWork} active` : "—"}</strong>
                    </div>
                    <div className="health-row">
                      <span>
                        <Database size={16} />
                        Queue attention
                      </span>
                      <strong>{overview ? overview.operationalHealth.queueAttention
                        ? `${overview.operationalHealth.queueAttention} action needed`
                        : `${overview.operationalHealth.activeQueueJobs} active · clear` : "—"}</strong>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
            </Suspense>
          </FeatureBoundary>
        </div>
      </main>

      {creatingProcess && (
        <FeatureBoundary>
          <Suspense fallback={<FeatureLoading label="process builder" />}>
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
          </Suspense>
        </FeatureBoundary>
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
            {selected.inputSchemaJson && (
              <div className="drawer-contract">
                <Code2 size={15} />
                <span>
                  <strong>Structured input required</strong>
                  <small>This release validates JSON before invoking the model.</small>
                </span>
                <button onClick={() => setRunInput(exampleFromSchema(selected.inputSchemaJson!))}>Use example</button>
              </div>
            )}
            <textarea
              className="run-input"
              placeholder={selected.inputSchemaJson ? '{\n  "field": "value"\n}' : "Describe the work you want this process to handle…"}
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

function exampleFromSchema(schemaJson: string) {
  try {
    const schema = JSON.parse(schemaJson) as { properties?: Record<string, Record<string, unknown>> };
    const result: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (Array.isArray(property.enum) && property.enum.length) result[name] = property.enum[0];
      else if (property.type === "number" || property.type === "integer") result[name] = Number(property.minimum ?? 0);
      else if (property.type === "boolean") result[name] = false;
      else if (property.type === "array") result[name] = [];
      else if (property.type === "object") result[name] = {};
      else result[name] = "";
    }
    return JSON.stringify(result, null, 2);
  } catch { return "{}"; }
}

function formatLatency(value: number | null) {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}
