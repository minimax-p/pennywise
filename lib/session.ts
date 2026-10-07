// Signed session cookie for the single Pennywise user.
// Uses only Web Crypto so it also runs in middleware (edge runtime).
// Token format: <base64url payload>.<base64url HMAC-SHA256 of payload>

export const SESSION_COOKIE = "pennywise_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function getSecret(): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("SESSION_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 32");
    }
    return secret;
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    bytes.forEach((b) => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
    return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
}

async function sign(data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw", encoder.encode(getSecret()), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]
    );
    return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
    const payload = toBase64Url(encoder.encode(JSON.stringify({exp: now + SESSION_MAX_AGE_SECONDS * 1000})));
    return `${payload}.${await sign(payload)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
    if (!token) return false;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    if (!constantTimeEqual(signature, await sign(payload))) return false;
    try {
        const {exp} = JSON.parse(fromBase64Url(payload));
        return typeof exp === "number" && exp > now;
    } catch {
        return false;
    }
}

// Where to go after logging in: only paths inside this app. Browsers read "//host",
// and a backslash in place of either slash, as another site, so those are refused.
export function safeRedirectPath(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
        return "/";
    }
    return value;
}
