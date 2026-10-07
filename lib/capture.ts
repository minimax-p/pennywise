import {createHash, randomBytes} from "node:crypto";
import {CaptureToken} from "@prisma/client";
import prisma from "@/lib/prisma";
import {clearFailures, isLockedOut, recordFailure} from "@/lib/loginThrottle";

// Device keys for the iPhone shortcuts (Apple Pay and Log a purchase). Keys are random, so a
// plain SHA-256 is enough to store them.

export function generateCaptureToken() {
    return `pw_${randomBytes(32).toString("base64url")}`;
}

export function hashCaptureToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

// Picks the account whose Apple Wallet card name matches what the shortcut sent
export function findAccountForCard<T extends { walletCardName: string | null, archived: boolean }>(accounts: T[], card: string | undefined | null): T | null {
    if (!card) return null;
    const wanted = card.trim().toLowerCase();
    const named = accounts.filter((a) => a.walletCardName && !a.archived);
    return named.find((a) => a.walletCardName!.trim().toLowerCase() === wanted)
        ?? named.find((a) => wanted.includes(a.walletCardName!.trim().toLowerCase()))
        ?? named.find((a) => a.walletCardName!.trim().toLowerCase().includes(wanted))
        ?? null;
}

// Shortcuts can send the date as text like "2026-10-06T20:15:00" or "Oct 6, 2026 at 8:15 PM".
// Returns the wall-clock time in UTC fields, the convention for transaction dates.
export function parseShortcutDate(value: string | undefined | null): Date | null {
    if (!value) return null;
    const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
        const [, y, m, d, hh = "0", mm = "0", ss = "0"] = iso;
        return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
    }
    const parsed = new Date(value.replace(" at ", " "));
    if (isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(),
        parsed.getHours(), parsed.getMinutes(), parsed.getSeconds()));
}

// Checks the device key on a shortcut request. Repeated bad keys from one address are locked out.
export async function authenticateDevice(request: Request): Promise<{ key: CaptureToken } | { response: Response }> {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const throttleKey = `capture:${ip}`;
    if (isLockedOut(throttleKey)) {
        return {response: Response.json({error: "Too many invalid keys. Try again later."}, {status: 429})};
    }
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const key = token ? await prisma.captureToken.findUnique({where: {tokenHash: hashCaptureToken(token)}}) : null;
    if (!key) {
        recordFailure(throttleKey);
        return {response: Response.json({error: "Invalid or missing key"}, {status: 401})};
    }
    clearFailures(throttleKey);
    return {key};
}

// "🛒 Groceries" as the shortcut shows it, or just "Groceries"
export function categoryLabel(category: { icon: string, name: string }) {
    return `${category.icon} ${category.name}`;
}

export function matchesCategoryLabel(category: { icon: string, name: string }, value: string) {
    const wanted = value.trim().toLowerCase();
    return category.name.toLowerCase() === wanted || categoryLabel(category).toLowerCase() === wanted;
}

// Choices in the "Log a purchase" shortcut that leave the category for the Sort page
export const SORT_LATER = ["Sort later", "Split later"];
export const NEW_PLACE = "New place…";
