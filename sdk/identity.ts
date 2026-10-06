export interface Identity {
  handle: string;
  publicKey: string;
  privateKey: CryptoKey;
}
export const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
export const unbase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export async function digest(bytes: Uint8Array) {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  );
}
export function signingText(
  method: string,
  url: string,
  handle: string,
  time: string,
  nonce: string,
  hash: string,
  type: string,
  encoding: string,
) {
  return [
    "ONE-SIGNATURE-V1",
    method.toUpperCase(),
    new URL(url).href,
    handle,
    time,
    nonce,
    hash,
    type,
    encoding,
  ].join("\n");
}
export async function createIdentity(handle: string): Promise<Identity> {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    handle: handle.toLowerCase(),
    publicKey: base64(
      new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)),
    ),
    privateKey: keys.privateKey,
  };
}
/** Explicit encrypted/OS-protected storage belongs to the host application. Never localStorage. */
export async function exportIdentity(identity: Identity) {
  return {
    handle: identity.handle,
    publicKey: identity.publicKey,
    privateKey: await crypto.subtle.exportKey("jwk", identity.privateKey),
  };
}
export async function importIdentity(saved: any): Promise<Identity> {
  return {
    handle: saved.handle,
    publicKey: saved.publicKey,
    privateKey: await crypto.subtle.importKey(
      "jwk",
      saved.privateKey,
      { name: "Ed25519" },
      true,
      ["sign"],
    ),
  };
}
export async function signedHeaders(
  identity: Identity,
  method: string,
  url: string,
  body: Uint8Array,
  headers: Record<string, string> = {},
) {
  const timestamp = String(Date.now()),
    nonce = crypto.randomUUID(),
    hash = await digest(body);
  const normalized = new Headers(headers);
  const payload = signingText(
    method,
    url,
    identity.handle,
    timestamp,
    nonce,
    hash,
    normalized.get("Content-Type") || "",
    normalized.get("Content-Encoding") || "identity",
  );
  return {
    ...headers,
    "X-One-Handle": identity.handle,
    "X-One-Time": timestamp,
    "X-One-Nonce": nonce,
    "X-One-Signature": base64(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          identity.privateKey,
          new TextEncoder().encode(payload),
        ),
      ),
    ),
  };
}
