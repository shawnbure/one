import { describe, expect, it } from "vitest";
import { renderOpportunityBriefHtml, type OpportunityImplementationBrief } from "../src/opportunity-brief";

const brief: OpportunityImplementationBrief = {
  schema: "workrr-opportunity-brief/v1",
  generatedAt: "2026-07-23T00:00:00.000Z",
  generatedBy: "builder@example.com",
  organization: "Example <Operations>",
  opportunity: {
    id: "opp-1", name: "Invoice <intake>", purpose: "Reduce manual entry.", owner: "Finance",
    department: "Operations", status: "qualified", currentSteps: "Receive; inspect; enter",
    systems: ["Inbox", "ERP"], exceptions: ["Unknown vendor"], qualificationNote: "Approval-gate writes."
  },
  baseline: {
    volumePerMonth: 400, minutesPerItem: 15, manualHoursPerMonth: 100,
    hourlyCost: 45, estimatedLaborPerMonth: 4500, errorRatePercent: 8
  },
  prioritization: {
    impact: 75, feasibility: 60, priority: 69,
    method: ["Impact and feasibility are separate."], interpretation: "Promising candidate."
  },
  controls: {
    risk: "medium", dataClassification: "confidential", externalAction: true, humanJudgment: "some",
    minimumPosture: ["Require approval for writes."]
  },
  cloudflarePattern: {
    template: "Document intake", executionProfile: "workflow", actorType: "Durable Workflow",
    consumerAffinity: "Execution-sticky", orchestration: "Cloudflare Workflow", state: "Workflow state and D1 evidence",
    inference: "Workers AI", asynchronousWork: "Queues and Workflows"
  },
  delivery: {
    readiness: [{ stage: "conversion", check: "Business owner confirmed", status: "confirmed",
      owner: "Finance", dueAt: null, evidence: "Owner approved the baseline." }],
    discoveryQuestions: ["Which system is authoritative?"], implementationChecklist: ["Define contracts."],
    acceptanceGates: ["Evaluation gate passes."], nextDecision: "Convert to a paused draft."
  },
  lineage: { blueprintId: null, blueprintName: null, convertedAt: null },
  limitations: ["Scores depend on customer assumptions."]
};

describe("opportunity implementation brief", () => {
  it("renders a printable FDE handoff with runtime affinity and acceptance evidence", () => {
    const html = renderOpportunityBriefHtml(brief);
    for (const heading of [
      "Business opportunity", "Manual baseline", "Prioritization", "Control posture",
      "Cloudflare execution pattern", "Open discovery questions", "Implementation checklist",
      "Delivery readiness", "Acceptance gates", "Lineage and limitations"
    ]) expect(html).toContain(heading);
    expect(html).toContain("Execution-sticky");
    expect(html).toContain("Evaluation gate passes.");
    expect(html).toContain("@media print");
  });

  it("escapes customer text and explicitly excludes sensitive implementation content", () => {
    const html = renderOpportunityBriefHtml(brief);
    expect(html).toContain("Example &lt;Operations&gt;");
    expect(html).toContain("Invoice &lt;intake&gt;");
    expect(html).not.toContain("Example <Operations>");
    expect(html).toContain("No credential values, prompt content, customer records, or provider tokens");
    expect(html).not.toMatch(/refresh_token|access_token|client_secret/i);
  });
});
