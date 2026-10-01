import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {randomBytes} from "node:crypto";
import {decryptSecret, encryptSecret} from "@/lib/crypto";

describe("encryptSecret / decryptSecret", () => {
    const original = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    beforeEach(() => {
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    });
    afterEach(() => {
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = original;
    });

    it("round trips and uses a fresh IV every time", () => {
        const secret = "access-sandbox-1234";
        const a = encryptSecret(secret);
        const b = encryptSecret(secret);
        expect(a).not.toContain(secret);
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe(secret);
        expect(decryptSecret(b)).toBe(secret);
    });

    it("accepts a hex encoded key", () => {
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
        expect(decryptSecret(encryptSecret("hello"))).toBe("hello");
    });

    it("rejects tampered ciphertext", () => {
        const [version, iv, tag, ciphertext] = encryptSecret("hello").split(":");
        const flipped = Buffer.from(ciphertext, "base64");
        flipped[0] ^= 1;
        expect(() => decryptSecret([version, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
    });

    it("rejects a different key", () => {
        const encrypted = encryptSecret("hello");
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
        expect(() => decryptSecret(encrypted)).toThrow();
    });

    it("explains a missing or short key", () => {
        delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
        expect(() => encryptSecret("hello")).toThrow(/PLAID_TOKEN_ENCRYPTION_KEY is not set/);
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
        expect(() => encryptSecret("hello")).toThrow(/must be 32 bytes/);
    });
});
