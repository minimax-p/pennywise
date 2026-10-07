import {createHash, randomBytes} from "node:crypto";

// Device keys for the Apple Pay shortcut. Keys are random, so a plain SHA-256 is enough to store them.

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
