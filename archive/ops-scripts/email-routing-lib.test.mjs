import assert from "node:assert/strict";
import test from "node:test";
import { planEmailRoute, verificationBody } from "./email-routing-lib.mjs";

const rule = {
  id: "a".repeat(32), enabled: true,
  matchers: [{ type: "literal", field: "to", value: "requests@example.com" }],
  actions: [{ type: "worker", value: ["workrr-one-dev"] }]
};

test("reuses one exact enabled Worker rule", () => {
  assert.equal(planEmailRoute([rule], "requests@example.com", "workrr-one-dev").action, "verify");
});

test("plans an exact literal-to Worker rule when absent", () => {
  const plan = planEmailRoute([], "requests@example.com", "workrr-one-dev");
  assert.equal(plan.action, "create");
  assert.deepEqual(plan.body.actions[0].value, ["workrr-one-dev"]);
});

test("refuses duplicates or a rule targeting a different Worker", () => {
  assert.throws(() => planEmailRoute([rule, rule], "requests@example.com", "workrr-one-dev"), /ambiguous/);
  assert.throws(() => planEmailRoute([{ ...rule, actions: [{ type: "worker", value: ["other"] }] }],
    "requests@example.com", "workrr-one-dev"), /does not deliver/);
});

test("builds bounded Workrr verification evidence", () => {
  assert.deepEqual(verificationBody({ address: "requests@example.com", routing_revision: 3 }, rule), {
    cloudflareRuleId: "a".repeat(32),
    evidenceReference: `cloudflare-email-routing-rule:${"a".repeat(32)}`,
    addressConfirmation: "requests@example.com",
    expectedRevision: 3
  });
});
