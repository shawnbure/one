import test from "node:test";
import assert from "node:assert/strict";
import { validateSolutionPackFiles } from "./solution-pack-validation-lib.mjs";

const processArtifact = {
  schemaVersion: 1,
  process: {
    name: "Reference process", description: "A complete portable reference process for customer operations.",
    executionProfile: "instant", modelProfile: "fast", modelId: "@cf/meta/llama-3.1-8b-instruct-fp8",
    autonomy: "suggest", dataClassification: "internal", tools: ["records_read"],
    toolDefinitions: [{ name: "records_read" }]
  },
  behavior: {
    systemPrompt: "Prepare a grounded result from approved records only.",
    instructions: ["Read facts", "Prepare result"], guardrails: ["Do not invent", "Do not write"],
    topology: { businessSteps: [{}, {}, {}] },
    acceptanceCases: [
      { name: "Missing record", input: "Record is missing", contains: ["missing"], prohibited: [] },
      { name: "Known record", input: "Record R-1 exists", contains: ["R-1"], prohibited: [] }
    ]
  },
  secrets: "excluded"
};
const manifest = (id) => ({
  schema: "workrr-solution-pack/v1", id, version: "1.0.0", name: "Reference pack",
  summary: "A complete reusable customer implementation reference pack.",
  audience: "Operations teams", processArtifact: "process.json",
  requiredConnections: [], handoffChecks: ["Confirm owner", "Connect source", "Run tests"],
  secrets: "excluded"
});

test("accepts two complete, secret-free portable packs", () => {
  const entries = ["first", "second"].flatMap((id) => [
    { file: `solution-packs/${id}/manifest.json`, content: JSON.stringify(manifest(id)) },
    { file: `solution-packs/${id}/process.json`, content: JSON.stringify(processArtifact) }
  ]);
  assert.deepEqual(validateSolutionPackFiles(entries), []);
});

test("rejects missing artifacts, forbidden credentials, and incomplete acceptance evidence", () => {
  const unsafe = structuredClone(processArtifact);
  unsafe.process.toolDefinitions[0].connectionId = "source-connection";
  unsafe.behavior.acceptanceCases = [];
  const entries = [
    { file: "solution-packs/first/manifest.json", content: JSON.stringify(manifest("duplicate")) },
    { file: "solution-packs/first/process.json", content: JSON.stringify(unsafe) },
    { file: "solution-packs/second/manifest.json", content: JSON.stringify(manifest("duplicate")) }
  ];
  const errors = validateSolutionPackFiles(entries).join("\n");
  assert.match(errors, /forbidden portable field/);
  assert.match(errors, /at least two acceptance cases/);
  assert.match(errors, /duplicate solution-pack id/);
  assert.match(errors, /referenced process artifact was not found/);
});
