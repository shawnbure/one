import assert from "node:assert/strict";
import test from "node:test";
import { availablePrecedence, publicPlan, registrationSql, resolveAccessApplication, serviceAuthPolicy,
  validateBootstrapInput } from "./service-principal-bootstrap-lib.mjs";

const valid = {
  environment: "dev",
  tenantId: "demo",
  name: "Workrr live verification dev",
  duration: "2160h",
  accountId: "a".repeat(32),
  domain: "one-dev.workrr.ai",
  audience: "b".repeat(64),
  databaseName: "workrr-platform-dev",
};

test("validates an expiring, environment-bound service principal request", () => {
  assert.equal(validateBootstrapInput(valid).durationHours, 2160);
  assert.throws(() => validateBootstrapInput({ ...valid, duration: "forever" }), /24h–8760h/);
  assert.throws(() => validateBootstrapInput({ ...valid, tenantId: "demo'; DROP TABLE" }), /tenant/);
  assert.throws(() => validateBootstrapInput({ ...valid, environment: "staging" }), /dev or production/);
});

test("resolves exactly one Access app only when domain and audience both match", () => {
  const app = { id: "app-1", name: "Workrr dev", domain: valid.domain, aud: valid.audience };
  assert.equal(resolveAccessApplication([app], valid.domain, valid.audience).id, "app-1");
  assert.throws(() => resolveAccessApplication([{ ...app, aud: "c".repeat(64) }],
    valid.domain, valid.audience), /do not both match/);
  assert.throws(() => resolveAccessApplication([], valid.domain, valid.audience), /found 0/);
});

test("creates a specific-token Service Auth policy rather than trusting any token", () => {
  const policy = serviceAuthPolicy(valid.name, "12345678-1234-1234-1234-123456789abc");
  assert.equal(policy.decision, "non_identity");
  assert.deepEqual(policy.include, [{
    service_token: { token_id: "12345678-1234-1234-1234-123456789abc" }
  }]);
  assert.equal(JSON.stringify(policy).includes("any_valid_service_token"), false);
  assert.equal(availablePrecedence([{ precedence: 10 }, { precedence: 1 }]), 2);
  assert.equal(availablePrecedence([{ precedence: 1 }]), 10);
});

test("generates a bounded operator upsert and a secret-free public plan", () => {
  const clientId = `${"a".repeat(32)}.access`;
  const sql = registrationSql({
    tenantId: "demo", clientId, displayName: "Customer's smoke operator"
  });
  assert.match(sql, /role='operator'/);
  assert.match(sql, /Customer''s smoke operator/);
  assert.doesNotMatch(sql, /client_secret/i);
  const plan = publicPlan({
    environment: "dev",
    app: { id: "app-1", name: "Workrr", domain: valid.domain, aud: valid.audience },
    tokenAction: "create", policyAction: "create", databaseName: valid.databaseName,
    tenantId: "demo", credentialPath: "/tmp/workrr-credentials.json"
  });
  assert.equal(plan.serviceToken.secretPrinted, false);
  assert.equal(JSON.stringify(plan).includes("clientSecret"), false);
  assert.equal(plan.accessPolicy.selector, "specific_service_token");
});
