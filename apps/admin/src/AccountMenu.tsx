import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import type { SessionData } from "./api";
import { ACCESS_LOGOUT_PATH, accountSummary } from "./account-session";
import "./account-menu.css";

export function AccountMenu({ session }: { session: SessionData | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const summary = accountSummary(session);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>(".account-trigger")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="account-control" ref={rootRef}>
      <button
        className="user account-trigger"
        type="button"
        aria-label={`Account: ${summary.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{summary.initials}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label="Account and organization">
          <div className="account-identity">
            <span className="account-avatar">{summary.initials}</span>
            <div>
              <strong>{summary.name}</strong>
              <small>{summary.email}</small>
            </div>
          </div>
          <div className="account-context">
            <span><Building2 size={16} /><span><small>Organization</small><strong>{summary.tenantName}</strong></span></span>
            <span><ShieldCheck size={16} /><span><small>Verified access</small><strong>{summary.roleLabel} · {summary.environmentLabel}</strong></span></span>
          </div>
          {summary.appDomain && <p>Signed in through Cloudflare Access for {summary.appDomain}.</p>}
          {session ? (
            <a role="menuitem" href={ACCESS_LOGOUT_PATH}>
              <LogOut size={16} />
              Sign out securely
            </a>
          ) : (
            <span className="account-preview">Connect identity to manage this account.</span>
          )}
        </div>
      )}
    </div>
  );
}
