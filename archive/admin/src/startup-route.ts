export interface StartupRoute {
  workspace: "Overview" | "Launchpad" | "Connections";
  processId: string | null;
  focusedLaunchpad: boolean;
  notice: string | null;
  anchor: "#connection-mcp" | null;
  consumesReturnState: boolean;
}

export function startupRoute(search: string): StartupRoute {
  const params = new URLSearchParams(search);
  const oauth = params.get("oauth");
  const mcp = params.get("mcp");
  if (mcp === "connected") return {
    workspace: "Connections", processId: null, focusedLaunchpad: false,
    notice: "MCP service connected. Review and govern its discovered capabilities before publishing a process release.",
    anchor: "#connection-mcp", consumesReturnState: true
  };
  if (mcp === "error") return {
    workspace: "Connections", processId: null, focusedLaunchpad: false,
    notice: "MCP authorization did not complete. Review the connector status and try again.",
    anchor: "#connection-mcp", consumesReturnState: true
  };
  if (oauth === "microsoft-connected") return {
    workspace: "Connections", processId: null, focusedLaunchpad: false,
    notice: "Microsoft 365 connected with encrypted delegated credentials.",
    anchor: null, consumesReturnState: true
  };
  if (oauth === "microsoft-error") return {
    workspace: "Connections", processId: null, focusedLaunchpad: false,
    notice: "Microsoft authorization did not complete. Review the app registration and try again.",
    anchor: null, consumesReturnState: true
  };
  const launchpad = params.get("workspace") === "launchpad";
  return {
    workspace: launchpad ? "Launchpad" : params.get("workspace") === "connections" ? "Connections" : "Overview",
    processId: launchpad ? boundedIdentifier(params.get("process")) : null,
    focusedLaunchpad: launchpad && params.get("focus") === "1",
    notice: null, anchor: null, consumesReturnState: false
  };
}

function boundedIdentifier(value: string | null) {
  const clean = value?.trim() ?? "";
  return clean.length > 0 && clean.length <= 120 && /^[A-Za-z0-9_-]+$/.test(clean) ? clean : null;
}
