import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {spawnSync} from "node:child_process";
import {createSessionToken, safeRedirectPath, SESSION_MAX_AGE_SECONDS, verifySessionToken} from "@/lib/session";
import {hashPassword, verifyPassword} from "@/lib/password";
import {clearFailures, isLockedOut, recordFailure} from "@/lib/loginThrottle";

describe("session tokens", () => {
    const original = process.env.SESSION_SECRET;
    beforeEach(() => {
        process.env.SESSION_SECRET = "a".repeat(40);
    });
    afterEach(() => {
        process.env.SESSION_SECRET = original;
    });

    it("accepts its own tokens until they expire", async () => {
        const now = Date.now();
        const token = await createSessionToken(now);
        expect(await verifySessionToken(token, now)).toBe(true);
        expect(await verifySessionToken(token, now + SESSION_MAX_AGE_SECONDS * 1000 + 1)).toBe(false);
    });

    it("rejects tampered, foreign and malformed tokens", async () => {
        const token = await createSessionToken();
        const [payload, signature] = token.split(".");
        const forgedPayload = btoa(JSON.stringify({exp: Date.now() + 10 ** 12})).replace(/=+$/, "");
        expect(await verifySessionToken(`${forgedPayload}.${signature}`)).toBe(false);
        expect(await verifySessionToken(`${payload}.${signature.slice(0, -2)}xx`)).toBe(false);
        expect(await verifySessionToken(undefined)).toBe(false);
        expect(await verifySessionToken("garbage")).toBe(false);

        process.env.SESSION_SECRET = "b".repeat(40);
        expect(await verifySessionToken(token)).toBe(false);
    });

    it("refuses to run with a short secret", async () => {
        process.env.SESSION_SECRET = "short";
        await expect(createSessionToken()).rejects.toThrow(/SESSION_SECRET/);
    });
});

describe("password hashes", () => {
    it("verifies the right password only", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(hash).toMatch(/^scrypt:16384:8:1:/);
        expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
        expect(await verifyPassword("correct horse battery stapler", hash)).toBe(false);
    });

    it("explains a missing hash", async () => {
        await expect(verifyPassword("anything", undefined)).rejects.toThrow(/PENNYWISE_PASSWORD_HASH/);
    });

    it("matches what scripts/hash-password.mjs prints", async () => {
        const result = spawnSync(process.execPath, ["scripts/hash-password.mjs"], {input: "a long enough password\n"});
        expect(result.status).toBe(0);
        const hash = result.stdout.toString().trim();
        expect(await verifyPassword("a long enough password", hash)).toBe(true);

        const tooShort = spawnSync(process.execPath, ["scripts/hash-password.mjs"], {input: "short\n"});
        expect(tooShort.status).toBe(1);
    });
});

describe("login throttle", () => {
    it("locks an address out after five failures for fifteen minutes", () => {
        const ip = "203.0.113.7";
        const start = 1_000_000;
        clearFailures(ip);
        for (let i = 0; i < 4; i++) recordFailure(ip, start + i);
        expect(isLockedOut(ip, start + 10)).toBe(false);
        recordFailure(ip, start + 20);
        expect(isLockedOut(ip, start + 30)).toBe(true);
        expect(isLockedOut("198.51.100.1", start + 30)).toBe(false);
        expect(isLockedOut(ip, start + 20 + 15 * 60 * 1000)).toBe(false);
    });
});

describe("safeRedirectPath", () => {
    it.each([
        ["/transactions?from=x", "/transactions?from=x"],
        ["/", "/"],
        ["//evil.example", "/"],
        ["/\\evil.example", "/"],
        ["https://evil.example", "/"],
        ["", "/"],
        [null, "/"],
    ])("%s -> %s", (input, expected) => {
        expect(safeRedirectPath(input)).toBe(expected);
    });
});
