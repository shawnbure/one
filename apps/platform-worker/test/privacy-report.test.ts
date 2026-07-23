import { describe, expect, it } from "vitest";
import { renderPrivacyArchitectureHtml, type PrivacyArchitectureReport } from "../src/privacy-report";

const report: PrivacyArchitectureReport = {
  schema: "workrr-privacy-architecture/v1",
  generatedAt: "2026-07-23T00:00:00.000Z",
  generatedBy: "auditor@example.com",
  organization: {
    id: "tenant-1", name: "Example <Operations>", environment: "development",
    identityBoundary: "https://workrr-one.cloudflareaccess.com",
    supportAccess: "Active tenant members only"
  },
  posture: ["Customer-dedicated Cloudflare deployment.", "Secrets are excluded."],
  services: [{ service: "Cloudflare D1", purpose: "Evidence", data: "Run summaries", boundary: "Tenant scoped" }],
  processes: [{ name: "Invoice review", autonomy: "approve", businessOwner: "Finance" }],
  dataSources: { knowledge: [{ name: "Policy" }], inboundWebhooks: [] },
  storageAndRetention: [{ store: "D1", content: "Evidence", retention: "30 days", deletion: "scheduled" }],
  models: [{ profile: "balanced", provider: "Cloudflare Workers AI", processes: 1 }],
  externalDestinations: [],
  credentials: [{ system: "Microsoft 365", scopes: ["Calendars.ReadWrite"], credential: "configured" }],
  tools: [{ name: "create event", access_mode: "write", risk_level: "medium" }],
  humanOversight: { pendingDecisions: 1, consequentialActions: 1, processPolicies: [] },
  loggingAndExport: ["Consequential actions are audited."],
  releaseInventory: [{ process: "Invoice review", processRelease: "release-1" }],
  readiness: [{ id: "identity", label: "Access boundary", ready: true, detail: "Configured" }],
  subprocessors: [{ provider: "Cloudflare", purpose: "Runtime", enabledBy: "Deployment" }],
  limitations: ["Not a compliance certification."]
};

describe("privacy and architecture report", () => {
  it("renders every required customer handoff section as printable, escaped HTML", () => {
    const html = renderPrivacyArchitectureHtml(report);
    for (const heading of [
      "Operating posture", "Cloudflare architecture", "AI processes and human oversight", "Models",
      "Data sources", "Storage, retention, and deletion", "Connections and credential scopes",
      "External destinations", "Typed tool boundary", "Release inventory", "Logging and export behavior",
      "Subprocessors and platform services", "Deployment readiness", "Important limitations"
    ]) expect(html).toContain(heading);
    expect(html).toContain("Example &lt;Operations&gt;");
    expect(html).not.toContain("Example <Operations>");
    expect(html).toContain("@media print");
  });

  it("contains credential readiness and scopes without inventing or embedding secret values", () => {
    const html = renderPrivacyArchitectureHtml(report);
    expect(html).toContain("Calendars.ReadWrite");
    expect(html).toContain("configured");
    expect(html).toContain("No credential or secret values are included");
    expect(html).not.toMatch(/client_secret|refresh_token|access_token/i);
  });
});
