// Symmetric encryption for secrets-at-rest (project storageState, refresh
// scripts). Uses AES-256-GCM with a key derived from JWT_SECRET via scrypt.
// Not a replacement for a proper KMS — but strictly better than storing
// auth blobs in plaintext JSON columns.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const SALT = 'bdd-project-auth-v1'; // static — key derivation is deterministic per env
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev-secret-change-me';
  return scryptSync(secret, SALT, KEY_LENGTH);
}

/** Encrypt any JSON-serializable value. Returns a base64 bundle that carries
 *  the IV + auth tag + ciphertext in one envelope. */
export function encryptJSON(value: unknown): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // envelope: [iv (12) | authTag (16) | ciphertext]
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptJSON<T = unknown>(envelope: string): T {
  const key = deriveKey();
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < IV_LENGTH + 16) throw new Error('encryption: envelope truncated');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
