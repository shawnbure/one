import { describe, expect, it } from "vitest";
import { assertMatchingFingerprint, executionFingerprint } from "../src/execution-idempotency";

const env = {
  OAUTH_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
} as never;

describe("execution idempotency fingerprint", () => {
  it("is stable across metadata key order but changes with protected content or actor identity", async () => {
    const base = {
      blueprintId: "process-1", threadId: "thread-1", input: "private input",
      metadata: { source: "api", correlation: "42" }
    };
    const first = await executionFingerprint(env, "tenant-1", base);
    const reordered = await executionFingerprint(env, "tenant-1", {
      ...base, metadata: { correlation: "42", source: "api" }
    });
    const changedInput = await executionFingerprint(env, "tenant-1", { ...base, input: "different" });
    const changedThread = await executionFingerprint(env, "tenant-1", { ...base, threadId: "thread-2" });
    expect(first).toBe(reordered);
    expect(first).not.toBe(changedInput);
    expect(first).not.toBe(changedThread);
    expect(first).not.toContain("private input");
  });

  it("rejects changed content while permitting exact and legacy fingerprint retries", () => {
    expect(() => assertMatchingFingerprint("digest-1", "digest-1")).not.toThrow();
    expect(() => assertMatchingFingerprint(null, "digest-1")).not.toThrow();
    expect(() => assertMatchingFingerprint("digest-1", "digest-2"))
      .toThrow("different execution content");
  });
});
