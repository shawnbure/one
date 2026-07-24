// @ts-expect-error Vitest executes in Node; the browser package intentionally omits Node ambient types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./readability.css", import.meta.url), "utf8");

describe("admin keyboard and navigation accessibility", () => {
  it("offers a visible-on-focus bypass to the focusable main workspace", () => {
    expect(app).toContain('className="skip-link" href="#main-content"');
    expect(app).toContain("mainRef.current?.focus()");
    expect(app).toContain('<main ref={mainRef} id="main-content" tabIndex={-1}>');
    expect(css).toContain(".skip-link:focus");
  });

  it("labels application navigation and icon-only actions", () => {
    expect(app).toContain('aria-label="Application navigation"');
    expect(app).toContain('<nav aria-label="Primary">');
    expect(app).toContain('aria-label="Open work inbox"');
  });

  it("exposes process details as a named modal with keyboard dismissal", () => {
    expect(app).toContain('role="dialog" aria-modal="true"');
    expect(app).toContain('aria-labelledby="process-drawer-title"');
    expect(app).toContain('aria-label="Close process details"');
    expect(app).toContain('if (event.key === "Escape") setSelected(null)');
    expect(app).toContain("drawerCloseRef.current?.focus()");
    expect(app).toContain('if (event.key !== "Tab") return');
    expect(app).toContain("previousFocus?.focus()");
  });
});
