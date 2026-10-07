// Slows down password guessing: after MAX_FAILURES wrong passwords from one IP
// within WINDOW_MS, that IP is locked out for WINDOW_MS. Kept in memory, which is
// enough for a single server process.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, number[]>();

function recent(ip: string, now: number) {
    const list = (failures.get(ip) ?? []).filter((time) => now - time < WINDOW_MS);
    if (list.length > 0) failures.set(ip, list);
    else failures.delete(ip);
    return list;
}

export function isLockedOut(ip: string, now = Date.now()) {
    return recent(ip, now).length >= MAX_FAILURES;
}

export function recordFailure(ip: string, now = Date.now()) {
    failures.set(ip, [...recent(ip, now), now]);
    // Keep memory bounded if many different addresses are guessing
    if (failures.size > 10_000) {
        for (const key of failures.keys()) recent(key, now);
    }
}

export function clearFailures(ip: string) {
    failures.delete(ip);
}
