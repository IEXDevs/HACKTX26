import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { encryptionKey } from "@/lib/env";

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * AES-256-GCM. The plaintext is never written to the database, never logged, and
 * never returned to a client — only decrypted in-process for the duration of a
 * single tool call.
 */
export function sealSecret(plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret(sealed: SealedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Non-secret hint shown in the vault UI: `ghp_…4f2a`. */
export function secretHint(plaintext: string): string {
  if (plaintext.length <= 8) return "…";
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}

export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Redact anything that looks like a credential before it reaches the event log. */
export function redactSecrets(input: string): string {
  return input
    .replace(/\b(sk|pk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{12,}\b/g, "[redacted-token]")
    .replace(/\bLLM_[A-Za-z0-9_]+/g, "[redacted-token]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[redacted-blob]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}
