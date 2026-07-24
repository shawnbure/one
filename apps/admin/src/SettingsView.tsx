import {
  Bell,
  ChevronRight,
  CircleDollarSign,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import "./settings-view.css";

interface Props {
  onNavigate: (workspace: string) => void;
}

const settingsModules = [
  {
    workspace: "Customer setup",
    icon: SlidersHorizontal,
    title: "Customer Environment",
    description: "Organization defaults, lifecycle ownership, deployment readiness, backup, and handoff.",
  },
  {
    workspace: "Team & roles",
    icon: Users,
    title: "Identity and Access",
    description: "Members, roles, service principals, active sessions, and emergency access evidence.",
  },
  {
    workspace: "Governance",
    icon: ShieldCheck,
    title: "Privacy and Governance",
    description: "DLP, retention, memory, incidents, external AI boundaries, and privacy reporting.",
  },
  {
    workspace: "Notifications",
    icon: Bell,
    title: "Notifications",
    description: "Accountable in-app, email, and webhook policies with delivery evidence.",
  },
  {
    workspace: "Usage & budgets",
    icon: CircleDollarSign,
    title: "Usage and Budgets",
    description: "Model usage, captured cost, budget thresholds, and billing reconciliation.",
  },
] as const;

export function SettingsView({ onNavigate }: Props) {
  return (
    <section className="settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow"><Settings2 size={16}/> ADMINISTRATION</span>
          <h1>Settings</h1>
          <p>Configure the customer environment without mixing administration into daily operations.</p>
        </div>
      </div>
      <div className="settings-module-grid">
        {settingsModules.map(({ workspace, icon: Icon, title, description }) => (
          <button key={workspace} onClick={() => onNavigate(workspace)}>
            <span className="settings-module-icon"><Icon size={21}/></span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ChevronRight size={18}/>
          </button>
        ))}
      </div>
    </section>
  );
}
