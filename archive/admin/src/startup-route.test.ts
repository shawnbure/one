import { describe, expect, it } from "vitest";
import { startupRoute } from "./startup-route";

describe("application return routing", () => {
  it("returns MCP OAuth outcomes to the governed connector catalog", () => {
    expect(startupRoute("?workspace=connections&section=mcp&mcp=connected")).toMatchObject({
      workspace: "Connections", anchor: "#connection-mcp", consumesReturnState: true,
      notice: expect.stringContaining("govern")
    });
    expect(startupRoute("?mcp=error")).toMatchObject({
      workspace: "Connections", anchor: "#connection-mcp", consumesReturnState: true,
      notice: expect.stringContaining("did not complete")
    });
  });

  it("returns Microsoft outcomes to Connections without accepting arbitrary workspaces", () => {
    expect(startupRoute("?oauth=microsoft-connected")).toMatchObject({
      workspace: "Connections", anchor: null, consumesReturnState: true
    });
    expect(startupRoute("?workspace=governance")).toMatchObject({
      workspace: "Overview", consumesReturnState: false
    });
  });

  it("preserves only bounded launchpad deep-link identity", () => {
    expect(startupRoute("?workspace=launchpad&process=process-1&focus=1")).toMatchObject({
      workspace: "Launchpad", processId: "process-1", focusedLaunchpad: true
    });
    expect(startupRoute("?workspace=launchpad&process=%2Funsafe&focus=1").processId).toBeNull();
  });
});
