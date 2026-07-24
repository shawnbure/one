import path from "node:path";

const supportedModels = new Set([
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/qwen/qwen3-30b-a3b-fp8"
]);
const forbiddenKeys = /^(?:secret|token|password|apiKey|clientSecret|connectionId|destination)$/i;

export function validateSolutionPackFiles(entries) {
  const errors = [];
  const parsed = new Map();
  for (const entry of entries.filter(({ file }) => file.endsWith(".json"))) {
    try { parsed.set(normalize(entry.file), JSON.parse(entry.content)); }
    catch { errors.push(`${entry.file}: invalid JSON`); }
  }
  const manifests = [...parsed].filter(([file]) => file.endsWith("/manifest.json"));
  if (manifests.length < 2) errors.push("solution-packs must contain at least two versioned reference manifests");
  const ids = new Set();
  for (const [file, manifest] of manifests) {
    const directory = path.posix.dirname(file);
    if (!manifest || typeof manifest !== "object" || manifest.schema !== "workrr-solution-pack/v1") {
      errors.push(`${file}: unsupported solution-pack schema`);
      continue;
    }
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(String(manifest.id ?? ""))) {
      errors.push(`${file}: invalid solution-pack id`);
    } else if (ids.has(manifest.id)) errors.push(`${file}: duplicate solution-pack id`);
    else ids.add(manifest.id);
    if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version ?? ""))) errors.push(`${file}: version must be semantic x.y.z`);
    if (!bounded(manifest.name, 3, 100) || !bounded(manifest.summary, 20, 500) ||
        !bounded(manifest.audience, 3, 200)) errors.push(`${file}: name, summary, and audience are required`);
    if (manifest.secrets !== "excluded") errors.push(`${file}: secrets must be explicitly excluded`);
    if (!Array.isArray(manifest.requiredConnections) || !Array.isArray(manifest.handoffChecks) ||
        manifest.handoffChecks.length < 3) errors.push(`${file}: connection and handoff guidance is incomplete`);
    const artifactName = String(manifest.processArtifact ?? "");
    if (!/^[a-z0-9-]+\.json$/.test(artifactName)) errors.push(`${file}: processArtifact must be a local JSON filename`);
    const artifactFile = `${directory}/${artifactName}`;
    const processPackage = parsed.get(artifactFile);
    if (!processPackage) errors.push(`${file}: referenced process artifact was not found`);
    else errors.push(...validateProcessArtifact(artifactFile, processPackage));
    errors.push(...findForbiddenKeys(file, manifest));
  }
  const referenced = new Set(manifests.map(([file, manifest]) =>
    `${path.posix.dirname(file)}/${String(manifest?.processArtifact ?? "")}`));
  for (const file of [...parsed.keys()].filter((candidate) => candidate.endsWith("/process.json"))) {
    if (!referenced.has(file)) errors.push(`${file}: process artifact is not referenced by its manifest`);
  }
  return errors;
}

function validateProcessArtifact(file, value) {
  const errors = [];
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 ||
      !value.process || !value.behavior) return [`${file}: incomplete process package`];
  if (value.secrets !== "excluded") errors.push(`${file}: secrets must be explicitly excluded`);
  if (!bounded(value.process.name, 3, 140) || !bounded(value.process.description, 20, 1200)) {
    errors.push(`${file}: process identity is incomplete`);
  }
  if (!supportedModels.has(value.process.modelId)) errors.push(`${file}: model is not a portable Workers AI model`);
  if (!["conversation", "consumer", "entity", "shared_shard", "temporary_durable", "instant", "workflow"]
    .includes(value.process.executionProfile)) errors.push(`${file}: execution profile is invalid`);
  if (!["observe", "suggest", "approve", "guarded", "autonomous"].includes(value.process.autonomy)) {
    errors.push(`${file}: autonomy is invalid`);
  }
  if (!["public", "internal", "confidential", "restricted"].includes(value.process.dataClassification)) {
    errors.push(`${file}: data classification is invalid`);
  }
  const tools = Array.isArray(value.process.tools) ? value.process.tools : [];
  const definitions = Array.isArray(value.process.toolDefinitions) ? value.process.toolDefinitions : [];
  if (tools.length !== definitions.length ||
      tools.some((name) => !definitions.some((tool) => tool?.name === name))) {
    errors.push(`${file}: every portable tool must have one matching non-secret definition`);
  }
  if (!bounded(value.behavior.systemPrompt, 20, 50_000) ||
      !Array.isArray(value.behavior.instructions) || value.behavior.instructions.length < 2 ||
      !Array.isArray(value.behavior.guardrails) || value.behavior.guardrails.length < 2) {
    errors.push(`${file}: prompt behavior is incomplete`);
  }
  if (!Array.isArray(value.behavior.topology?.businessSteps) ||
      value.behavior.topology.businessSteps.length < 3) errors.push(`${file}: business topology is incomplete`);
  if (!Array.isArray(value.behavior.acceptanceCases) ||
      value.behavior.acceptanceCases.length < 2) errors.push(`${file}: at least two acceptance cases are required`);
  else for (const [index, item] of value.behavior.acceptanceCases.entries()) {
    if (!bounded(item?.name, 3, 120) || !bounded(item?.input, 1, 10_000) ||
        (!item?.contains?.length && !item?.prohibited?.length)) {
      errors.push(`${file}: acceptance case ${index + 1} is incomplete`);
    }
  }
  errors.push(...findForbiddenKeys(file, value));
  return errors;
}

function findForbiddenKeys(file, value, trail = []) {
  if (!value || typeof value !== "object") return [];
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) errors.push(`${file}: forbidden portable field ${[...trail, key].join(".")}`);
    errors.push(...findForbiddenKeys(file, child, [...trail, key]));
  }
  return errors;
}
function bounded(value, minimum, maximum) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum;
}
function normalize(value) { return value.replaceAll("\\", "/"); }
