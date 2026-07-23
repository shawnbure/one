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

  it("keeps identical consumers and entities sticky while separating different identities", () => {
    const consumer = (id: string) => instanceKeyFor("consumer", { blueprintId: "support", consumerId: id, input: "hello" });
    const entity = (id: string) => instanceKeyFor("entity", { blueprintId: "case-review", entityId: id, input: "hello" });
    expect(consumer("user-1")).toBe(consumer("user-1"));
    expect(consumer("user-1")).not.toBe(consumer("user-2"));
    expect(entity("case-1")).toBe("case-review:entity:case-1");
  });

  it("uses an explicit idempotency identity for temporary durable work", () => {
    expect(instanceKeyFor("temporary_durable", { blueprintId: "extract", idempotencyKey: "job-42", input: "hello" }))
      .toBe("extract:temporary:job-42");
  });
});
