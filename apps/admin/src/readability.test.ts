// @ts-expect-error Vitest executes in Node; the browser package intentionally omits Node ambient types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./readability.css", import.meta.url), "utf8");
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
    for (const selector of ["small", "label", "time", "code", "dt", "dd"]) {
      expect(contract).toContain(selector);
    }
    for (const selector of ["button", "input", "textarea", "select", "p", "li", "td", "th"]) {
      expect(contract).toContain(selector);
    }
  });

  it("keeps interactive controls comfortably tappable on small screens", () => {
    expect(contract).toContain("@media (max-width: 760px)");
    expect(contract).toContain('input:not([type="checkbox"]):not([type="radio"])');
    expect(contract).toContain("min-height: 42px !important");
  });

  it("provides a compact mobile navigation state", () => {
    expect(css).toContain("aside:not(.mobile-open) > nav");
    expect(css).toContain(".mobile-nav-toggle");
  });
});
