import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  Clock3,
  FileSearch,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { api, type ProcessTemplate } from "./api";

interface Props {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  onNotice: (message: string) => void;
}

export function CreateProcessWizard({ onClose, onCreated, onNotice }: Props) {
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [owner, setOwner] = useState("Shawn Bure");
  const [department, setDepartment] = useState("Operations");
  const [risk, setRisk] = useState("medium");
  const [volume, setVolume] = useState(500);
  const [minutes, setMinutes] = useState(10);
  const [hourlyCost, setHourlyCost] = useState(40);
  const [errorRate, setErrorRate] = useState(5);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api
      .processTemplates()
      .then((result) => setTemplates(result.data))
      .catch((error: Error) => onNotice(error.message));
  }, []);
  const selected = templates.find((template) => template.id === templateId);
  const score = useMemo(
    () =>
      Math.min(
        100,
        Math.min(30, Math.round(volume / 50)) +
          Math.min(30, Math.round(minutes / 2)) +
          Math.min(20, Math.round(hourlyCost / 5)) +
          Math.min(20, Math.round(errorRate * 2)),
      ),
    [volume, minutes, hourlyCost, errorRate],
  );
  const monthlyHours = Math.round((volume * minutes) / 60);
  const monthlyCost = Math.round(monthlyHours * hourlyCost);
  function choose(template: ProcessTemplate) {
    setTemplateId(template.id);
    if (!name) setName(template.name);
    if (!purpose) setPurpose(template.description);
  }
  async function create() {
    setBusy(true);
    try {
      const result = await api.createProcess({
        templateId,
        name,
        purpose,
        businessOwner: owner,
        department,
        riskLevel: risk,
        baseline: {
          volumePerMonth: volume,
          minutesPerItem: minutes,
          hourlyCost,
          errorRate: errorRate / 100,
        },
      });
      onNotice(
        `${name} created with an opportunity score of ${result.opportunityScore}.`,
      );
      await onCreated(result.id);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Process creation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard-backdrop">
      <section className="process-wizard">
        <header>
          <div>
            <span className="brandmark">
              <Workflow size={17} />
            </span>
            <span>
              <strong>Create an AI Process</strong>
              <small>Discovery-led implementation</small>
            </span>
          </div>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="wizard-progress">
          {[1, 2, 3, 4].map((value) => (
            <span key={value} className={step >= value ? "active" : ""}>
              <i>{step > value ? <Check size={12} /> : value}</i>
              <small>
                {
                  ["Opportunity", "Template", "Definition", "Baseline"][
                    value - 1
                  ]
                }
              </small>
            </span>
          ))}
        </div>
        <main>
          {step === 1 && (
            <div className="wizard-step">
              <span className="wizard-icon">
                <FileSearch size={22} />
              </span>
              <h1>What work should AI improve?</h1>
              <p>
                Start with the business outcome and the manual process—not the
                model.
              </p>
              <label>
                Process name
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Example: Vendor invoice review"
                />
              </label>
              <label>
                Purpose and desired outcome
                <textarea
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="Describe what happens today and what better looks like…"
                />
              </label>
              <div className="two-fields">
                <label>
                  Business owner
                  <input
                    value={owner}
                    onChange={(event) => setOwner(event.target.value)}
                  />
                </label>
                <label>
                  Department
                  <input
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="wizard-step wide">
              <span className="wizard-icon">
                <Sparkles size={22} />
              </span>
              <h1>Choose a starting pattern</h1>
              <p>
                Templates provide safe Cloudflare primitives, prompts, tools,
                and approval defaults. Everything remains editable.
              </p>
              <div className="template-grid">
                {templates.map((template) => (
                  <button
                    className={templateId === template.id ? "selected" : ""}
                    key={template.id}
                    onClick={() => choose(template)}
                  >
                    <span>
                      {template.execution_profile === "workflow" ? (
                        <Workflow size={20} />
                      ) : (
                        <Bot size={20} />
                      )}
                    </span>
                    <strong>{template.name}</strong>
                    <small>{template.description}</small>
                    <em>
                      {template.execution_profile} · {template.model_profile} ·{" "}
                      {template.autonomy}
                    </em>
                    {templateId === template.id && (
                      <i>
                        <Check size={13} />
                      </i>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="wizard-step">
              <span className="wizard-icon">
                <ShieldCheck size={22} />
              </span>
              <h1>Set the initial control posture</h1>
              <p>
                This process begins paused with a draft release. It cannot
                operate until reviewed and published.
              </p>
              <label>
                Risk classification
                <select
                  value={risk}
                  onChange={(event) => setRisk(event.target.value)}
                >
                  <option value="low">Low · internal and reversible</option>
                  <option value="medium">
                    Medium · business impact or external communication
                  </option>
                  <option value="high">
                    High · financial, legal, regulated, or irreversible
                  </option>
                </select>
              </label>
              <div className="definition-summary">
                <span>
                  <small>EXECUTION</small>
                  <strong>
                    {selected?.execution_profile ?? "Select a template"}
                  </strong>
                </span>
                <span>
                  <small>MODEL</small>
                  <strong>{selected?.model_profile ?? "—"}</strong>
                </span>
                <span>
                  <small>AUTONOMY</small>
                  <strong>{selected?.autonomy ?? "—"}</strong>
                </span>
                <span>
                  <small>STARTING MODE</small>
                  <strong>Paused</strong>
                </span>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="wizard-step">
              <span className="wizard-icon">
                <CircleDollarSign size={22} />
              </span>
              <h1>Capture the manual baseline</h1>
              <p>
                These assumptions make business value measurable after the
                process launches.
              </p>
              <div className="baseline-grid">
                <label>
                  Items per month
                  <input
                    type="number"
                    min="0"
                    value={volume}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                </label>
                <label>
                  Minutes per item
                  <input
                    type="number"
                    min="0"
                    value={minutes}
                    onChange={(event) => setMinutes(Number(event.target.value))}
                  />
                </label>
                <label>
                  Loaded hourly cost
                  <input
                    type="number"
                    min="0"
                    value={hourlyCost}
                    onChange={(event) =>
                      setHourlyCost(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Current error / rework %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={errorRate}
                    onChange={(event) =>
                      setErrorRate(Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <div className="opportunity-result">
                <span className="score-ring">{score}</span>
                <div>
                  <strong>Opportunity score</strong>
                  <small>
                    {monthlyHours} manual hours · approximately $
                    {monthlyCost.toLocaleString()} monthly effort
                  </small>
                </div>
              </div>
            </div>
          )}
        </main>
        <footer>
          <button disabled={step === 1} onClick={() => setStep(step - 1)}>
            <ArrowLeft size={15} />
            Back
          </button>
          <span>Step {step} of 4</span>
          {step < 4 ? (
            <button
              className="primary"
              disabled={
                (step === 1 && (!name.trim() || !purpose.trim())) ||
                (step === 2 && !templateId)
              }
              onClick={() => setStep(step + 1)}
            >
              Continue
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create draft process"}
              <Sparkles size={15} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
