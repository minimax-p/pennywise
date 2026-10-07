import {cookies} from "next/headers";
import {SESSION_COOKIE, verifySessionToken} from "@/lib/session";

// Pennywise has a single user. Set PENNYWISE_USER_ID to an old Clerk user id
// to keep data created before the switch to password login.
export function getOwnerId() {
    return process.env.PENNYWISE_USER_ID || "owner";
}

export type CurrentUser = {
    id: string;
    firstName: string | null;
};

// Returns null when the request has no valid session
export async function currentUser(): Promise<CurrentUser | null> {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!(await verifySessionToken(token))) return null;
    return {id: getOwnerId(), firstName: process.env.PENNYWISE_NAME || null};
}
