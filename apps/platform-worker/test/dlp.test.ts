import { describe, expect, it } from "vitest";
import { applyDlp, createCustomDlpEntry, DlpBlockedError, scanSensitiveText,
  updateCustomDlpEntry, updateDlpRule } from "../src/dlp";
import { sanitizeAsyncExecutionInput } from "../src/execution";

function dlpEnvironment(rules: Array<{ detector: string; action: string; direction?: string; enabled?: number }>) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        sql,
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM agent_blueprints")) return {
            id: "process-1", tenant_id: "tenant-1", name: "Process", description: "",
            execution_profile: "instant", model_profile: "fast", prompt_release_id: "prompt-1",
            autonomy: "suggest", status: "active", tools_json: "[]", updated_at: "now",
            input_schema_json: null, output_schema_json: null
          };
          return null;
        },
        async all() {
          if (sql.includes("custom_dlp_entries")) return { results: [] };
          return { results: rules.map((rule) => ({ direction: "both", enabled: 1, ...rule })) };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(items: Array<{ run(): Promise<unknown> }>) {
      for (const item of items) await item.run();
      return [];
    }
  };
  return { env: { DB } as never, writes };
}

describe("tenant DLP policy", () => {
  it("redacts selected detectors before the model while audit-only values remain available", async () => {
    const { env, writes } = dlpEnvironment([
      { detector: "email", action: "redact" },
      { detector: "ip_address", action: "audit" }
    ]);
    const result = await applyDlp(env, "tenant-1", "Contact sam@example.com from 10.0.0.8", {
      direction: "input", stage: "execution", executionId: "execution-1", blueprintId: "process-1"
    });
    expect(result.modelText).toBe("Contact [REDACTED_EMAIL] from 10.0.0.8");
    expect(result.safeText).toBe("Contact [REDACTED_EMAIL] from [REDACTED_IP]");
    expect(result.blocked).toBe(false);
    expect(writes).toHaveLength(2);
    expect(JSON.stringify(writes)).not.toContain("sam@example.com");
    expect(JSON.stringify(writes)).not.toContain("10.0.0.8");
  });

  it("blocks valid payment cards without flagging arbitrary long numbers", () => {
    const valid = scanSensitiveText("Card 4111 1111 1111 1111");
    const invalid = scanSensitiveText("Reference 4111 1111 1111 1112");
    expect(valid.text).toContain("[REDACTED_PAYMENT_CARD]");
    expect(valid.types).toContain("payment_card");
    expect(invalid.text).toContain("4111 1111 1111 1112");
    expect(invalid.types).not.toContain("payment_card");
  });

  it("rejects blocked content before Queue handoff", async () => {
    const { env } = dlpEnvironment([{ detector: "ssn", action: "block" }]);
    await expect(sanitizeAsyncExecutionInput(env, "tenant-1", {
      blueprintId: "process-1", input: "SSN 123-45-6789"
    }, "execution-1")).rejects.toBeInstanceOf(DlpBlockedError);
  });

  it("queues only policy-redacted input", async () => {
    const { env } = dlpEnvironment([{ detector: "email", action: "redact" }]);
    const request = await sanitizeAsyncExecutionInput(env, "tenant-1", {
      blueprintId: "process-1", input: "Email sam@example.com"
    }, "execution-1");
    expect(request.input).toBe("Email [REDACTED_EMAIL]");
  });

  it("updates exactly one tenant-scoped rule and writes content-free audit evidence", async () => {
    const { env, writes } = dlpEnvironment([]);
    const result = await updateDlpRule(env, "tenant-1", "member-1", "email",
      { action: "block", direction: "input", enabled: true });
    expect(result).toMatchObject({ detector: "email", action: "block", direction: "input", enabled: true });
    expect(writes[0]?.sql).toContain("WHERE tenant_id=? AND detector=?");
    expect(writes[0]?.bindings.slice(-2)).toEqual(["tenant-1", "email"]);
    expect(writes[1]?.sql).toContain("dlp.rule_updated");
  });

  it("stores custom phrases only as encrypted values and content-free audit evidence", async () => {
    const { env, writes } = dlpEnvironment([]);
    Object.assign(env as object, { OAUTH_TOKEN_ENCRYPTION_KEY:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const result = await createCustomDlpEntry(env, "tenant-1", "member-1", {
      label: "Acquisition codename", term: "Project Falcon", action: "block", direction: "both"
    });
    expect(result).toMatchObject({ label: "Acquisition codename", action: "block", revision: 1 });
    expect(JSON.stringify(writes)).not.toContain("Project Falcon");
    expect(writes.some((write) => write.sql.includes("custom_dlp_entries"))).toBe(true);
  });

  it("uses optimistic revisions for tenant-scoped custom policy changes", async () => {
    const { env, writes } = dlpEnvironment([]);
    const result = await updateCustomDlpEntry(env, "tenant-1", "member-1", "entry-1", {
      action: "redact", direction: "output", enabled: false, expectedRevision: 3
    });
    expect(result).toMatchObject({ id: "entry-1", revision: 4, enabled: false });
    expect(writes[0]?.sql).toContain("id=? AND tenant_id=? AND revision=?");
    expect(writes[0]?.bindings.slice(-3)).toEqual(["entry-1", "tenant-1", 3]);
  });

  it("decrypts an enabled custom phrase only at the boundary and redacts it from model and evidence", async () => {
    let custom: Record<string, unknown> | null = null;
    const writes: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = {
      prepare(sql: string) {
        let bindings: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) { bindings = values; return statement; },
          async first() {
            if (sql.includes("COUNT(*)")) return { total: custom ? 1 : 0 };
            return null;
          },
          async all() {
            if (sql.includes("FROM custom_dlp_entries")) return { results: custom ? [custom] : [] };
            return { results: [] };
          },
          async run() {
            writes.push({ sql, bindings });
            if (sql.includes("INSERT INTO custom_dlp_entries")) custom = {
              id: bindings[0], label: bindings[2], term_ciphertext: bindings[3], term_iv: bindings[4],
              action: bindings[6], direction: bindings[7], enabled: 1, revision: 1,
              updated_by: bindings[9], updated_at: "now"
            };
            return { meta: { changes: 1 } };
          }
        };
        return statement;
      },
      async batch(items: Array<{ run(): Promise<unknown> }>) {
        for (const item of items) await item.run();
        return [];
      }
    };
    const env = { DB, OAUTH_TOKEN_ENCRYPTION_KEY:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } as never;
    await createCustomDlpEntry(env, "tenant-1", "member-1", {
      label: "Acquisition codename", term: "Project Falcon", action: "redact", direction: "both"
    });
    const result = await applyDlp(env, "tenant-1", "Discuss Project Falcon tomorrow", {
      direction: "input", stage: "execution"
    });
    expect(result.modelText).toBe("Discuss [REDACTED_CUSTOM] tomorrow");
    expect(result.safeText).toBe("Discuss [REDACTED_CUSTOM] tomorrow");
    expect(result.types).toContain(`custom:${String(custom?.id)}`);
    expect(JSON.stringify(writes)).not.toContain("Project Falcon");
  });
});
