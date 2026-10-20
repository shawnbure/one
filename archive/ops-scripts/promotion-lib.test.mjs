import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromotionPlan,
  migrationNames,
  missingRequiredSecrets,
  parseArguments,
  parseSecretNames,
  validatePromotion
} from "./promotion-lib.mjs";

test("parses explicit apply confirmation without inventing authority", () => {
  assert.deepEqual(parseArguments(["--apply", "--sha", "a".repeat(40), "--confirm", "production"]), {
    apply: true, sha: "a".repeat(40), confirm: "production"
  });
});

test("blocks dirty, divergent, stale, or unconfirmed production promotion", () => {
  const errors = validatePromotion({
    apply: true, sha: "b".repeat(40), confirm: undefined,
    originDev: "a".repeat(40), originMain: "c".repeat(40), clean: false, mainIsAncestor: false, pushAllowed: true
  });
  assert.equal(errors.length, 4);
  assert.match(errors.join(" "), /clean/);
  assert.match(errors.join(" "), /origin\/dev/);
  assert.match(errors.join(" "), /confirm production/);
});

test("extracts migration and secret evidence from Wrangler output", () => {
  assert.deepEqual(migrationNames("│ 0020_oauth.sql │\n│ 0021_dlp.sql │\n0021_dlp.sql"), [
    "0020_oauth.sql", "0021_dlp.sql"
  ]);
  assert.deepEqual(parseSecretNames('[{"name":"MICROSOFT_CLIENT_ID"},{"name":"OAUTH_TOKEN_ENCRYPTION_KEY"}]'), [
    "MICROSOFT_CLIENT_ID", "OAUTH_TOKEN_ENCRYPTION_KEY"
  ]);
  assert.deepEqual(missingRequiredSecrets(["MICROSOFT_CLIENT_ID", "OAUTH_TOKEN_ENCRYPTION_KEY"]), [
    "MICROSOFT_CLIENT_SECRET", "RUBRIC_SIGNING_JWK"
  ]);
});

test("produces a reviewable plan with no secret values", () => {
  const plan = buildPromotionPlan({
    apply: false,
    targetSha: "a".repeat(40),
    originMain: "b".repeat(40),
    commits: ["abc123 Feature"],
    pendingMigrations: ["0022_templates.sql"],
    presentSecrets: ["MICROSOFT_CLIENT_ID"],
    missingSecrets: ["MICROSOFT_CLIENT_SECRET"]
  });
  assert.equal(plan.mode, "dry-run");
  assert.deepEqual(plan.database.pendingMigrations, ["0022_templates.sql"]);
  assert.deepEqual(plan.requiredSecrets.missing, ["MICROSOFT_CLIENT_SECRET"]);
  assert.equal(JSON.stringify(plan).includes("secret-value"), false);
});
