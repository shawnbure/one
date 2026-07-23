import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Box,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  FileText,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { api, type GovernanceData } from "./api";

interface Props {
  section: "Connections" | "Knowledge" | "Evaluations" | "Governance";
  onNotice: (message: string) => void;
}

export function FoundationView({ section, onNotice }: Props) {
  const [data, setData] = useState<GovernanceData | null>(null);
  async function load() {
    try {
      setData((await api.governance()).data);
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Could not load governance data",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (!data)
    return <div className="loading-card">Loading {section.toLowerCase()}…</div>;
  if (section === "Connections") return <Connections data={data} />;
  if (section === "Knowledge") return <Knowledge data={data} />;
  if (section === "Evaluations") return <Evaluations data={data} onReload={load} onNotice={onNotice} />;
  return <Governance data={data} onReload={load} onNotice={onNotice} />;
}

function Connections({ data }: { data: GovernanceData }) {
  return (
    <section className="foundation-page">
      <Title
        icon={<Link2 size={14} />}
        eyebrow="INTEGRATION BOUNDARY"
        title="Connections"
        text="Credentials, permissions, ownership, and health for every system an AI process can reach."
      />
      <div className="foundation-grid">
        {data.connections.map((item) => (
          <article className="foundation-card panel" key={String(item.id)}>
            <div>
              <span className="foundation-icon">
                <Link2 size={18} />
              </span>
              <span className={`connection-state ${item.status}`}>
                <i />
                {item.status}
              </span>
            </div>
            <h2>{item.name}</h2>
            <p>
              {String(item.kind).replaceAll("_", " ")} ·{" "}
              {String(item.access_mode).replaceAll("_", " ")} access
            </p>
            <dl>
              <div>
                <dt>Owner</dt>
                <dd>{item.owner}</dd>
              </div>
              <div>
                <dt>Credential</dt>
                <dd>
                  {Number(item.secret_configured) ? "Configured" : "Required"}
                </dd>
              </div>
              <div>
                <dt>Last health check</dt>
                <dd>{item.last_checked_at || "Never"}</dd>
              </div>
            </dl>
            <div className="scope-row">
              {parseArray(String(item.scopes_json)).map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>
            <button>
              <RefreshCw size={14} />
              Test connection
            </button>
          </article>
        ))}
      </div>
      <div className="webhook-section">
        <div className="section-head">
          <div>
            <h2>Inbound webhooks</h2>
            <p>Signed, idempotent process triggers with Queue buffering.</p>
          </div>
        </div>
        {data.webhooks.map((webhook) => (
          <article className="webhook-row panel" key={webhook.id}>
            <span className="foundation-icon">
              <KeyRound size={17} />
            </span>
            <span>
              <strong>{webhook.name}</strong>
              <small>
                POST /webhooks/{webhook.id} · {webhook.blueprint_id}
              </small>
            </span>
            <span>
              <small>ACCEPTS</small>
              <strong>
                {parseArray(webhook.accepted_events_json).join(", ")}
              </strong>
            </span>
            <span>
              <small>SECRET</small>
              <strong>
                {webhook.secret_configured ? "Configured" : "Required"}
              </strong>
            </span>
            <span
              className={`connection-state ${webhook.status === "active" ? "healthy" : "attention"}`}
            >
              <i />
              {webhook.status}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
function Knowledge({ data }: { data: GovernanceData }) {
  return (
    <section className="foundation-page">
      <Title
        icon={<Database size={14} />}
        eyebrow="PROVENANCE AND ACCESS"
        title="Knowledge"
        text="Approved sources remain attributable, sensitivity-labelled, and explicitly bound to processes."
      />
      <div className="knowledge-list panel">
        {data.knowledge.map((item) => (
          <article key={String(item.id)}>
            <span className="knowledge-icon">
              <FileText size={19} />
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.provenance}</small>
              <em>
                {parseArray(item.allowed_processes_json ?? "[]").join(" · ")}
              </em>
            </span>
            <span>
              <small>SENSITIVITY</small>
              <strong>{item.sensitivity}</strong>
            </span>
            <span>
              <small>OWNER</small>
              <strong>{item.owner}</strong>
            </span>
            <span className={`connection-state ${item.status}`}>
              <i />
              {item.status}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
function Evaluations({ data, onReload, onNotice }: { data: GovernanceData; onReload: () => Promise<void>; onNotice: (message: string) => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const passing = data.evaluations.filter(
    (item) => item.status === "passing",
  ).length;
  async function run(id: string) {
    setRunning(id);
    try {
      const result = await api.runEvaluation(id);
      onNotice(`Evaluation ${result.data.status}: ${result.data.passedAssertions}/${result.data.assertionCount} assertions`);
      await onReload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Evaluation could not run");
    } finally {
      setRunning(null);
    }
  }
  return (
    <section className="foundation-page">
      <Title
        icon={<FileCheck2 size={14} />}
        eyebrow="QUALITY AND RELEASE GATES"
        title="Evaluations"
        text="Deterministic policy checks and golden scenarios protect every behavior release."
      />
      <div className="evaluation-score panel">
        <span className="score-ring">
          {passing}/{data.evaluations.length}
        </span>
        <div>
          <h2>Release gate health</h2>
          <p>
            All required scenarios must pass before a high-impact process
            release can be promoted.
          </p>
        </div>
        <span className="healthy">
          <i />
          Passing
        </span>
      </div>
      <div className="evaluation-list panel">
        {data.evaluations.map((item) => (
          <article key={String(item.id)}>
            <span className={`eval-icon ${item.status}`}>
              {item.status === "passing" ? (
                <CheckCircle2 size={18} />
              ) : (
                <XCircle size={18} />
              )}
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.process_name} · {item.category}
              </small>
            </span>
            <span>
              <small>ASSERTIONS</small>
              <strong>{item.assertion_count}</strong>
            </span>
            <span>
              <small>LAST RUN</small>
              <strong>{item.last_run_at}</strong>
            </span>
            <span className={`connection-state ${item.status}`}>
              <i />
              {item.status}
            </span>
            <button disabled={running === item.id} onClick={() => void run(String(item.id))}>
              <RefreshCw size={14} /> {running === item.id ? "Running…" : "Run"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Governance({
  data,
  onReload,
  onNotice,
}: {
  data: GovernanceData;
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const ready = data.readiness.filter((item) => item.ready).length;
  async function mode(processId: string | undefined, nextMode: string) {
    if (!processId) return;
    try {
      await api.setProcessMode(
        processId,
        nextMode,
        "Changed from Governance Center",
      );
      onNotice(
        `Process operating mode changed to ${nextMode.replaceAll("_", " ")}.`,
      );
      await onReload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Mode change failed");
    }
  }
  return (
    <section className="foundation-page">
      <div className="governance-title">
        <Title
          icon={<ShieldCheck size={14} />}
          eyebrow="PRIVACY AND CONTROL"
          title="Governance"
          text="A demonstrable private-AI posture: models, data flows, roles, retention, releases, and emergency controls."
        />
        <a className="export-button" href="/api/governance/export">
          <Download size={15} /> Export readiness evidence
        </a>
      </div>
      <div className="governance-top">
        <article className="readiness panel">
          <div className="section-head">
            <div>
              <h2>Deployment readiness</h2>
              <p>
                {ready} of {data.readiness.length} controls ready
              </p>
            </div>
            <span
              className={
                ready === data.readiness.length
                  ? "ready-badge"
                  : "attention-badge"
              }
            >
              {Math.round((ready / data.readiness.length) * 100)}%
            </span>
          </div>
          <div className="readiness-bar">
            <i style={{ width: `${(ready / data.readiness.length) * 100}%` }} />
          </div>
          {data.readiness.map((item) => (
            <div className="readiness-row" key={item.id}>
              {item.ready ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
        </article>
        <article className="data-flow panel">
          <div className="section-head">
            <div>
              <h2>Private AI data flow</h2>
              <p>Customer-dedicated Cloudflare boundary</p>
            </div>
            <LockKeyhole size={18} />
          </div>
          <div>
            {data.dataFlow.map((node, index) => (
              <span key={node}>
                <i>
                  {index === 0 ? (
                    <Box size={16} />
                  ) : index === 3 ? (
                    <Bot size={16} />
                  ) : index === 4 ? (
                    <Users size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                </i>
                <strong>{node}</strong>
                {index < data.dataFlow.length - 1 && <ArrowRight size={14} />}
              </span>
            ))}
          </div>
        </article>
      </div>
      <div className="governance-section panel">
        <div className="section-head">
          <div>
            <h2>Process operating controls</h2>
            <p>
              Changes take effect immediately and are recorded in the
              administrative audit log.
            </p>
          </div>
        </div>
        {data.processes.map((process) => (
          <div className="control-row" key={process.id}>
            <span>
              <strong>{process.name}</strong>
              <small>
                {process.business_owner} · {process.risk_level} risk ·{" "}
                {process.autonomy} autonomy
              </small>
            </span>
            <select
              value={process.operating_mode}
              onChange={(event) => void mode(process.id, event.target.value)}
            >
              <option value="active">Active</option>
              <option value="read_only">Read only</option>
              <option value="approval_only">Approval only</option>
              <option value="paused">Paused</option>
              <option value="drain">Drain</option>
              <option value="emergency_stop">Emergency stop</option>
            </select>
          </div>
        ))}
      </div>
      <div className="governance-bottom">
        <article className="model-inventory panel">
          <div className="section-head">
            <div>
              <h2>Model inventory</h2>
              <p>Approved inference profiles</p>
            </div>
          </div>
          {data.models.map((model) => (
            <div key={model.profile}>
              <span className="foundation-icon">
                <Bot size={16} />
              </span>
              <span>
                <strong>{model.profile}</strong>
                <small>
                  {model.provider} · {model.boundary}
                </small>
              </span>
              <em>{model.processes} processes</em>
            </div>
          ))}
        </article>
        <article className="retention panel">
          <div className="section-head">
            <div>
              <h2>Retention policy</h2>
              <p>Scheduled lifecycle controls</p>
            </div>
          </div>
          {data.retention.map((policy) => (
            <div key={String(policy.id)}>
              <span>
                <strong>{policy.name}</strong>
                <small>
                  {policy.data_class} ·{" "}
                  {String(policy.deletion_mode).replaceAll("_", " ")}
                </small>
              </span>
              <em>{policy.retention_days} days</em>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}

function Title({
  icon,
  eyebrow,
  title,
  text,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">
          {icon}
          {eyebrow}
        </span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function parseArray(value: string): string[] {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}
