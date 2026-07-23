import { describe, expect, it } from "vitest";
import { authorizedWorkspaceLabels, processVisibleInCommands, searchCommands,
  type CommandSearchItem } from "./command-search";

const items: CommandSearchItem[] = [
  { id: "workspace:activity", label: "Activity", description: "Inspect run evidence",
    keywords: ["runs", "timeline"], kind: "workspace", target: "Activity" },
  { id: "workspace:api", label: "API logs", description: "Inspect webhook requests",
    keywords: ["webhooks", "http"], kind: "workspace", target: "API logs" },
  { id: "process:triage", label: "Inbox Triage", description: "Route customer email",
    keywords: ["instant", "active"], kind: "process", target: "triage" }
];

describe("command search", () => {
  it("ranks exact and prefix labels ahead of metadata matches", () => {
    expect(searchCommands(items, "activity").map((item) => item.id)).toEqual(["workspace:activity"]);
    expect(searchCommands(items, "api")[0]?.id).toBe("workspace:api");
    expect(searchCommands(items, "runs")[0]?.id).toBe("workspace:activity");
  });

  it("matches multi-token process intent and preserves stable empty-query order", () => {
    expect(searchCommands(items, "customer email")[0]?.id).toBe("process:triage");
    expect(searchCommands(items, "", 2).map((item) => item.id)).toEqual([
      "workspace:activity", "workspace:api"
    ]);
  });

  it("returns no unrelated commands", () => {
    expect(searchCommands(items, "payroll")).toEqual([]);
  });

  it("keeps consumer commands inside employee authorization boundaries", () => {
    expect(authorizedWorkspaceLabels(true)).toEqual(["Overview", "Launchpad", "Help Center"]);
    expect(authorizedWorkspaceLabels(true)).not.toContain("Governance");
    expect(processVisibleInCommands({
      status: "active", activeReleaseId: "release-1", executionProfile: "conversation"
    }, true)).toBe(true);
    expect(processVisibleInCommands({
      status: "active", activeReleaseId: "release-1", executionProfile: "entity"
    }, true)).toBe(false);
    expect(processVisibleInCommands({
      status: "testing", activeReleaseId: "release-1", executionProfile: "instant"
    }, true)).toBe(false);
    expect(processVisibleInCommands({
      status: "active", activeReleaseId: null, executionProfile: "instant"
    }, true)).toBe(false);
  });
});
