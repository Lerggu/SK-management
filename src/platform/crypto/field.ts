/**
 * Field-level encryption for highly sensitive personal data, e.g. the Finnish
 * personal identity code (ADR 0028). AES-256-GCM with a key that exists only
 * in the environment (`SK_FIELD_KEY`, 32 bytes base64, from Key Vault in
 * Azure). A keyed HMAC of the normalized value lets the database enforce
 * uniqueness without storing the value in clear. Sub-keys are derived with
 * HKDF so the encryption and lookup keys differ.
 *
 * Outside production a fixed development key is used, so tests and local
 * development work without configuration; production without a key refuses
 * to encrypt (the caller shows "not available").
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { isProduction } from "@/platform/config/env";

const DEV_KEY = Buffer.alloc(32, 7); // development and tests only; never used in production
const VERSION = "v1";

export class FieldKeyMissingError extends Error {}

function masterKey(): Buffer | null {
  const raw = process.env.SK_FIELD_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new FieldKeyMissingError("SK_FIELD_KEY must be 32 bytes (base64)");
    return key;
  }
  return isProduction() ? null : DEV_KEY;
}

function subKey(purpose: "enc" | "mac"): Buffer {
  const key = masterKey();
  if (!key) throw new FieldKeyMissingError("SK_FIELD_KEY is not configured");
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), `sk-field-${purpose}`, 32));
}

/** Whether sensitive fields can be stored in this environment. */
export function fieldEncryptionAvailable(): boolean {
  try {
    return masterKey() !== null;
  } catch {
    return false;
  }
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subKey("enc"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptField(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unknown encrypted field format");
  const decipher = createDecipheriv("aes-256-gcm", subKey("enc"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Keyed hash for uniqueness checks (hex, 64 chars). */
export function fieldLookupHash(normalized: string): string {
  return createHmac("sha256", subKey("mac")).update(normalized).digest("hex");
}
