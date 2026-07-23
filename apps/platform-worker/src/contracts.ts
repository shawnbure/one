import { Validator, type OutputUnit, type Schema } from "@cfworker/json-schema";

export type ProcessSchema = Record<string, unknown>;
export interface ReleaseContracts {
  inputSchema: ProcessSchema | null;
  outputSchema: ProcessSchema | null;
}

export class ContractViolationError extends Error {
  readonly code = "CONTRACT_VIOLATION";
  constructor(readonly direction: "input" | "output", readonly issues: string[]) {
    super(`${direction === "input" ? "Input" : "Output"} contract rejected the payload: ${issues.join("; ")}`);
  }
}

export function normalizeProcessSchema(value: unknown, label: "input" | "output"): ProcessSchema | null {
  if (value === null || value === undefined || value === "") return null;
  const schema = typeof value === "string" ? parseSchema(value, label) : value;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`${title(label)} schema must be a JSON object`);
  const serialized = JSON.stringify(schema);
  if (serialized.length > 12_000) throw new Error(`${title(label)} schema exceeds 12 KB`);
  const candidate = schema as ProcessSchema;
  if (candidate.type !== "object") throw new Error(`${title(label)} schema root type must be object`);
  assertSchemaSafety(candidate, label);
  validatorFor(candidate, label).validate({});
  return candidate;
}

export function parseContracts(inputSchemaJson?: string | null, outputSchemaJson?: string | null): ReleaseContracts {
  return {
    inputSchema: inputSchemaJson ? JSON.parse(inputSchemaJson) as ProcessSchema : null,
    outputSchema: outputSchemaJson ? JSON.parse(outputSchemaJson) as ProcessSchema : null
  };
}

export function validateContractInput(input: string, schema: ProcessSchema | null) {
  if (!schema) return { value: input, status: "not_configured" as const };
  const value = parsePayload(input, "input");
  assertValid(value, schema, "input");
  return { value: JSON.stringify(value), status: "passed" as const };
}

export function validateContractOutput(output: string, schema: ProcessSchema | null) {
  if (!schema) return { value: output, status: "not_configured" as const };
  const value = parsePayload(stripCodeFence(output), "output");
  assertValid(value, schema, "output");
  return { value: JSON.stringify(value), status: "passed" as const };
}

export function outputContractInstruction(input: string, schema: ProcessSchema | null) {
  if (!schema) return input;
  return `${input}\n\n--- OUTPUT CONTRACT ---\nReturn only one JSON object. Do not use Markdown fences or commentary. The object must satisfy this JSON Schema:\n${JSON.stringify(schema)}\n--- END OUTPUT CONTRACT ---`;
}

export function isContractViolation(error: unknown): error is ContractViolationError {
  return error instanceof ContractViolationError ||
    (error instanceof Error && error.message.includes("contract rejected the payload"));
}

function parseSchema(value: string, label: string) {
  try { return JSON.parse(value) as unknown; }
  catch { throw new Error(`${title(label)} schema must be valid JSON`); }
}
function parsePayload(value: string, direction: "input" | "output") {
  try { return JSON.parse(value) as unknown; }
  catch { throw new ContractViolationError(direction, ["payload must be valid JSON"]); }
}
function assertValid(value: unknown, schema: ProcessSchema, direction: "input" | "output") {
  const result = validatorFor(schema, direction).validate(value);
  if (!result.valid) throw new ContractViolationError(direction, formatErrors(result.errors));
}
function validatorFor(schema: ProcessSchema, label: string): Validator {
  try { return new Validator(schema as Schema, "2020-12", false); }
  catch (error) { throw new Error(`${title(label)} schema is invalid: ${error instanceof Error ? error.message : String(error)}`); }
}
function formatErrors(errors: OutputUnit[] | null | undefined) {
  return (errors ?? []).slice(0, 8).map((error) =>
    `${error.instanceLocation || "/"} ${error.error || "is invalid"}`.trim());
}
function stripCodeFence(value: string) {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}
function assertSchemaSafety(schema: ProcessSchema, label: string) {
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 250 || depth > 12) throw new Error(`${title(label)} schema is too complex`);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (["$ref", "$recursiveRef", "$dynamicRef", "$defs", "definitions"].includes(key)) {
        throw new Error(`${title(label)} schema cannot use external or recursive references`);
      }
      if (key === "pattern" && (typeof item !== "string" || item.length > 200)) {
        throw new Error(`${title(label)} schema patterns must be 200 characters or fewer`);
      }
      if (key === "pattern" && typeof item === "string") {
        try { new RegExp(item); } catch { throw new Error(`${title(label)} schema contains an invalid pattern`); }
      }
      visit(item, depth + 1);
    }
  };
  visit(schema, 0);
}
function title(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
