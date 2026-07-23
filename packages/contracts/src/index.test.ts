import { describe, expect, it } from "vitest";
import { instanceKeyFor } from "./index";

describe("instanceKeyFor", () => {
  it("keeps a conversation sticky to its thread", () => {
    expect(instanceKeyFor("conversation", { blueprintId: "support", threadId: "t-42", input: "hello" }))
      .toBe("support:thread:t-42");
  });

  it("does not create identity for instant work", () => {
    expect(instanceKeyFor("instant", { blueprintId: "classify", input: "hello" })).toBeNull();
  });

  it("rejects an ambiguous durable identity", () => {
    expect(() => instanceKeyFor("entity", { blueprintId: "account", input: "hello" })).toThrow("entityId");
  });
});
