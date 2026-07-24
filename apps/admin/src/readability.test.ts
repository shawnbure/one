// @ts-expect-error Vitest executes in Node; the browser package intentionally omits Node ambient types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./readability.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const visualPolishCss = readFileSync(new URL("./visual-polish.css", import.meta.url), "utf8");
const wizardCss = readFileSync(new URL("./wizard-readability.css", import.meta.url), "utf8");
const actorHealthCss = readFileSync(new URL("./actor-health.css", import.meta.url), "utf8");
const bulkApprovalCss = readFileSync(new URL("./bulk-approvals.css", import.meta.url), "utf8");
const contractStart = css.indexOf("Product-wide legibility contract");
const contract = css.slice(contractStart);

describe("product readability contract", () => {
  it("stays at the end of the global accessibility layer", () => {
    expect(contractStart).toBeGreaterThan(0);
    expect(contract).toContain("font-size: 13px !important");
    expect(contract).toContain("font-size: 14px !important");
    expect(contract).toContain("font-size: 12px !important");
  });

  it("covers semantic metadata, body copy, and every form control", () => {
    for (const selector of ["small", "label", "time", "code", "dt", "dd", "strong", "em"]) {
      expect(contract).toContain(selector);
    }
    for (const selector of ["button", "input", "textarea", "select", "p", "li", "td", "th"]) {
      expect(contract).toContain(selector);
    }
    for (const selector of [".eyebrow", ".crumb", ".tags i", ".health-row",
      ".member-row > span:first-child > i", ".mcp-policy-note"]) {
      expect(contract).toContain(selector);
    }
    expect(contract).toContain(".scope-row span");
    expect(contract).toContain(".session-kind");
    expect(contract).toContain(".tool-access");
  });

  it("keeps interactive controls comfortably tappable on small screens", () => {
    expect(contract).toContain("@media (max-width: 760px)");
    expect(contract).toContain('input:not([type="checkbox"]):not([type="radio"])');
    expect(contract).toContain("min-height: 42px !important");
    expect(css).toContain(".activity-metrics { grid-template-columns: 1fr; }");
    expect(css).toContain(".runs-head > :nth-child(5)");
    expect(css).toContain(".recovery-queue > .section-head");
    expect(css).toContain(".work-row > svg { display: none; }");
    expect(css).toContain(".review-main { padding: 18px; }");
    expect(css).toContain(".decision-context { grid-template-columns: 1fr; }");
    expect(css).toContain(".run-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }");
    expect(css).toContain(".run-heading-actions > :last-child");
    expect(css).toContain(".content header");
    expect(css).toContain(".studio-page > .page-title");
    expect(css).toContain(".portfolio-actions");
    expect(css).toContain(".connection-workspace-index");
    expect(css).toContain(".typed-tool-list article > .connection-state");
  });

  it("keeps durable actor health evidence readable without desktop-only columns", () => {
    expect(actorHealthCss).toContain("font-size:14px");
    expect(actorHealthCss).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(actorHealthCss).toContain("@media(max-width:800px)");
    expect(actorHealthCss).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(actorHealthCss).toContain(".actor-health>header>button{width:100%");
  });

  it("keeps reviewer capacity readable and stacked on mobile", () => {
    expect(bulkApprovalCss).toContain(".reviewer-capacity");
    expect(bulkApprovalCss).toContain("font-size:13px");
    expect(bulkApprovalCss).toContain("@media(max-width:760px)");
    expect(bulkApprovalCss).toContain(".reviewer-capacity>div:last-child{grid-template-columns:1fr}");
    expect(bulkApprovalCss).toContain(".reviewer-capacity>div>button{min-height:52px}");
  });

  it("provides a compact mobile navigation state", () => {
    expect(css).toContain(".shell > aside:not(.mobile-open) > nav");
    expect(css).toContain(".mobile-nav-toggle");
  });

  it("scopes app chrome and applies one shared visual system", () => {
    expect(shellCss).toContain(".shell > aside {");
    expect(shellCss).toContain(".shell > main > header {");
    expect(shellCss).not.toMatch(/^aside\s*\{/m);
    expect(shellCss).not.toMatch(/^header\s*\{/m);
    expect(visualPolishCss).toContain("--font-body:");
    expect(visualPolishCss).toContain("--focus-ring:");
    expect(visualPolishCss).toContain(".shell > aside nav button");
    expect(visualPolishCss).toContain(".shell > main > header");
  });

  it("keeps the six-template creation wizard readable and scroll-safe", () => {
    expect(wizardCss).toContain("width: min(1040px");
    expect(wizardCss).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(wizardCss).toContain(".process-wizard > footer { grid-column: 1; }");
    expect(wizardCss).toContain("overflow-y: auto");
    expect(wizardCss).toContain(".template-grid { grid-template-columns: repeat(3");
    expect(wizardCss).toContain(".template-grid small");
    expect(wizardCss).toContain("font-size: 13px");
    expect(wizardCss).toContain("@media (max-width: 820px)");
    expect(wizardCss).toContain(".template-grid { grid-template-columns: 1fr; }");
  });

  it("keeps inbound email configuration responsive and readable", () => {
    expect(css).toContain(".email-route-create");
    expect(css).toContain(".email-route-row");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain(".webhook-create, .webhook-row { grid-template-columns: 1fr; }");
  });

  it("keeps the governed workflow editor usable at desktop and mobile widths", () => {
    expect(css).toContain(".workflow-step-editor");
    expect(css).toContain("grid-template-columns: 30px minmax(145px");
    expect(css).toContain(".workflow-step-editor input, .workflow-step-editor select { min-height: 40px");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".workflow-step-editor { grid-template-columns: 30px 1fr; }");
  });

  it("keeps MCP connector governance readable and responsive", () => {
    expect(css).toContain(".mcp-create");
    expect(css).toContain("grid-template-columns: minmax(150px");
    expect(css).toContain(".mcp-connectors { grid-template-columns: 1fr; }");
    expect(css).toContain(".mcp-tools > article { grid-template-columns: auto 1fr; }");
  });

  it("provides readable local navigation across the long Connections workspace", () => {
    expect(css).toContain(".connection-workspace-index");
    expect(css).toContain("grid-template-columns: repeat(5");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain(".connection-anchor { scroll-margin-top:");
  });

  it("keeps return-route feedback visible after deep-linking into a workspace", () => {
    expect(css).toContain(".notice");
    expect(css).toContain("position: sticky");
    expect(css).toContain("top: 76px");
  });

  it("keeps the AI Gateway governance handoff readable on desktop and mobile", () => {
    expect(css).toContain(".ai-gateway-form");
    expect(css).toContain("grid-template-columns: minmax(180px");
    expect(css).toContain(".gateway-check");
    expect(css).toContain(".ai-gateway-form { grid-template-columns: 1fr; }");
  });
});
