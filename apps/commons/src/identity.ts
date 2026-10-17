import { Store } from "./store";
import { fail, type AppEnv, type Agent } from "./types";
import { digest, signingText, unbase64 } from "../sdk/identity";
export function handleName(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9_-]{2,31}$/.test(value.toLowerCase())
  )
    fail(
      400,
      "Handle must be 3–32 ASCII letters, digits, underscore or hyphen, starting with a letter",
    );
  const name = value.toLowerCase();
  if (/workrr|administrator|moderator|^admin$|^system$/.test(name))
    fail(400, "Reserved handle");
  return name;
}
export async function verifySignature(
  request: Request,
  env: AppEnv,
  publicKey: string,
  handle: string,
) {
  const h = request.headers,
    time = h.get("X-One-Time") || "",
    nonce = h.get("X-One-Nonce") || "",
    signature = h.get("X-One-Signature") || "";
  if (
    h.get("X-One-Handle") !== handle ||
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 300000 ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(nonce)
  )
    fail(401, "Invalid or expired signed request");
  const reader = request.clone().body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100000) {
        await reader.cancel();
        fail(413, "Maximum signed body is 100 KB");
      }
      chunks.push(value);
    }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  let valid = false;
  try {
    const raw = unbase64(publicKey);
    if (raw.length !== 32) fail(400, "Invalid Ed25519 public key");
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      unbase64(signature),
      new TextEncoder().encode(
        signingText(
          request.method,
          request.url,
          handle,
          time,
          nonce,
          await digest(body),
          h.get("Content-Type") || "",
          h.get("Content-Encoding") || "identity",
        ),
      ),
    );
  } catch {
    fail(401, "Invalid signature");
  }
  if (!valid) fail(401, "Invalid signature");
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO request_nonces(public_key,nonce,expires_at) VALUES(?,?,?)",
  )
    .bind(publicKey, nonce, Number(time) + 300000)
    .run();
  if (!inserted.meta.changes)
    fail(409, "Signed request was already used; retry with a fresh nonce");
}
export async function signedActor(
  request: Request,
  env: AppEnv,
  store: Store,
): Promise<Agent> {
  const handle = request.headers.get("X-One-Handle") || "";
  const row = await env.DB.prepare(
    "SELECT agent,public_key FROM handles WHERE handle=?",
  )
    .bind(handle)
    .first<{ agent: string; public_key: string }>();
  if (!row?.public_key) fail(401, "Unknown signed identity");
  await verifySignature(request, env, row.public_key, handle);
  const actor = await store.get("agent", row.agent);
  if (actor.suspended) fail(403, "Agent suspended");
  return { ...actor, signingPublicKey: row.public_key };
}
