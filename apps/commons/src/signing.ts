import { base64, unbase64 } from "../sdk/identity";
import { fail, type AppEnv } from "./types";

/** Deterministic JSON: object keys sorted recursively, so a signature over a
 *  record is stable regardless of key order. Used for every WXP signing text. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Verify a base64 Ed25519 detached signature over `message` by `publicKey`
 *  (base64 raw 32-byte key). Mirrors the WebCrypto path in identity.ts. */
export async function verifyDetached(
  publicKey: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const raw = unbase64(publicKey);
    if (raw.length !== 32) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      raw as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      unbase64(signature) as BufferSource,
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

/** The server's ledger signing key. A base64 PKCS8 Ed25519 private key in
 *  WXP_LEDGER_KEY is used when present (stable across deploys, publishable
 *  public key); otherwise a per-isolate key is generated so dev and tests still
 *  produce verifiable signatures. The public key is exposed at discovery. */
let signingKey: Promise<{ priv: CryptoKey; publicKey: string }> | null = null;
export function ledgerKey(env: AppEnv) {
  if (signingKey) return signingKey;
  signingKey = (async () => {
    if (env.WXP_LEDGER_KEY) {
      const priv = await crypto.subtle.importKey(
        "pkcs8",
        unbase64(env.WXP_LEDGER_KEY) as BufferSource,
        { name: "Ed25519" },
        false,
        ["sign"],
      );
      // The matching public key is published separately via WXP_LEDGER_PUBKEY.
      return { priv, publicKey: env.WXP_LEDGER_PUBKEY || "" };
    }
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    return {
      priv: pair.privateKey,
      publicKey: base64(
        new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      ),
    };
  })();
  return signingKey;
}

/** Server signature (base64) over a canonical message, for ledger entries and
 *  reputation outcomes — any party can export and verify them. */
export async function serverSign(env: AppEnv, message: string): Promise<string> {
  const { priv } = await ledgerKey(env);
  return base64(
    new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        priv,
        new TextEncoder().encode(message),
      ),
    ),
  );
}

export async function ledgerPublicKey(env: AppEnv): Promise<string> {
  return (await ledgerKey(env)).publicKey;
}

/** Guard: the actor authenticated with an Ed25519 signed request (not a bearer
 *  token), required for every value-moving transition so the event is signed. */
export function requireSigned(signingPublicKey?: string): string {
  return signingPublicKey || fail(401, "A signed request (Ed25519) is required");
}
