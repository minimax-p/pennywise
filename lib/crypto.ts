import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

// AES-256-GCM encryption for secrets stored in the database (Plaid access tokens).
// Stored format: v1:<iv>:<auth tag>:<ciphertext>, each part base64 encoded.

const VERSION = "v1";
const IV_LENGTH = 12;

function getKey(): Buffer {
    const raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error("PLAID_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
    }
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error("PLAID_TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as base64 or 64 hex characters");
    }
    return key;
}

export function encryptSecret(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split(":");
    if (version !== VERSION || !iv || !tag || !ciphertext) {
        throw new Error("Unrecognized encrypted secret format");
    }
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final(),
    ]).toString("utf8");
}
