import {randomBytes, scrypt, timingSafeEqual} from "node:crypto";

// Password hashes are stored as scrypt:N:r:p:<salt>:<hash> (salt and hash base64).
// scripts/hash-password.mjs produces the same format for PENNYWISE_PASSWORD_HASH.

const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, {N, r, p, maxmem: 128 * N * r * 2}, (error, key) => {
            if (error) reject(error);
            else resolve(key);
        });
    });
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const [N, r, p] = [16384, 8, 1];
    const hash = await scryptAsync(password, salt, N, r, p);
    return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join(":");
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
    const [scheme, N, r, p, salt, hash] = (stored ?? "").split(":");
    if (scheme !== "scrypt" || !salt || !hash) {
        throw new Error("PENNYWISE_PASSWORD_HASH is missing or invalid. Generate it with: node scripts/hash-password.mjs");
    }
    const expected = Buffer.from(hash, "base64");
    const actual = await scryptAsync(password, Buffer.from(salt, "base64"), Number(N), Number(r), Number(p));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
