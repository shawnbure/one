import type { SessionData } from "./api";

export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function accountSummary(session: SessionData | null) {
  const name = session?.user.name.trim() || "Secure preview";
  const initials = session
    ? name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
    : "SB";

  return {
    name,
    initials,
    email: session?.user.email ?? "Identity is not connected",
    tenantName: session?.tenantName ?? "Workrr One",
    roleLabel: session ? titleCase(session.user.role) : "Preview",
    environmentLabel: session ? titleCase(session.environment) : "Local preview",
    appDomain: session?.appDomain ?? "",
  };
}
