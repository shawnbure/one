import type { ExecutionRequest } from "@workrr/contracts";
import type { Env } from "./types";

export async function executionFingerprint(
  env: Env,
  tenantId: string,
  request: ExecutionRequest,
  protectedInput: string = request.input,
) {
  const root = env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!root) throw new Error("Platform encryption key is not configured");
  const raw = fromBase64Url(root);
  if (raw.byteLength !== 32) throw new Error("Platform encryption key must be 32 bytes");
  const material = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("workrr-one"),
    info: new TextEncoder().encode("execution-idempotency/digest/v1"),
  }, material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const canonical = JSON.stringify({
    tenantId,
    blueprintId: request.blueprintId,
    consumerId: request.consumerId ?? null,
    threadId: request.threadId ?? null,
    entityId: request.entityId ?? null,
    shardKey: request.shardKey ?? null,
    input: protectedInput,
    metadata: Object.fromEntries(Object.entries(request.metadata ?? {}).sort(([left], [right]) =>
      left.localeCompare(right))),
  });
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return base64Url(new Uint8Array(digest));
}

export function assertMatchingFingerprint(existing: string | null | undefined, requested: string) {
  if (existing && existing !== requested) {
    throw new IdempotencyConflictError("Idempotency key was already used with different execution content");
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
}

export function isIdempotencyConflict(error: unknown): error is IdempotencyConflictError {
  return error instanceof IdempotencyConflictError;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
