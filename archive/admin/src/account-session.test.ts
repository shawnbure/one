import { describe, expect, it } from "vitest";
import { ACCESS_LOGOUT_PATH, accountSummary } from "./account-session";

describe("account session presentation", () => {
  it("formats the server-resolved identity without changing its authority", () => {
    expect(accountSummary({
      user: { id: "member-1", email: "operator@example.com", name: "Sam Builder", role: "process_owner" },
      tenantId: "customer-1",
      tenantName: "Customer One",
      accentColor: "#1f7a5b",
      environment: "development",
      appDomain: "one-dev.workrr.ai",
    })).toEqual({
      name: "Sam Builder",
      initials: "SB",
      email: "operator@example.com",
      tenantName: "Customer One",
      roleLabel: "Process Owner",
      environmentLabel: "Development",
      appDomain: "one-dev.workrr.ai",
    });
  });

  it("provides an honest preview identity and the same-origin Access logout path", () => {
    expect(accountSummary(null)).toMatchObject({
      name: "Secure preview",
      email: "Identity is not connected",
      roleLabel: "Preview",
    });
    expect(ACCESS_LOGOUT_PATH).toBe("/cdn-cgi/access/logout");
  });
});
