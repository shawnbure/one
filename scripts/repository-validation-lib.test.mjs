import assert from "node:assert/strict";
import test from "node:test";
import { findHighConfidenceSecrets, validateMigrationNames } from "./repository-validation-lib.mjs";

test("accepts sequential, conventionally named D1 migrations", () => {
  assert.deepEqual(validateMigrationNames([
    "migrations/0001_initial.sql",
    "migrations/0002_add_process.sql"
  ]), []);
});

test("rejects migration gaps, duplicates, and unsafe names", () => {
  const errors = validateMigrationNames([
    "migrations/0001_initial.sql",
    "migrations/0003_gap.sql",
    "migrations/0003_duplicate.sql",
    "migrations/unsafe-name.sql"
  ]);
  assert.ok(errors.some((error) => error.includes("Expected migration 0002")));
  assert.ok(errors.some((error) => error.includes("Duplicate migration number")));
  assert.ok(errors.some((error) => error.includes("Invalid migration filename")));
});

test("detects high-confidence committed secrets without flagging placeholders", () => {
  assert.deepEqual(findHighConfidenceSecrets([
    { file: ".dev.vars.example", content: "CLOUDFLARE_API_TOKEN=your-token-here" }
  ]), []);
  assert.deepEqual(findHighConfidenceSecrets([
    { file: "bad.env", content: `CLOUDFLARE_API_TOKEN=${"a".repeat(32)}` }
  ]), ["bad.env:1: possible assigned deployment secret"]);
});
