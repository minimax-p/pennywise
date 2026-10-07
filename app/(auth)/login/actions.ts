"use server";

import {cookies, headers} from "next/headers";
import {redirect} from "next/navigation";
import {verifyPassword} from "@/lib/password";
import {createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS} from "@/lib/session";
import {clearFailures, isLockedOut, recordFailure} from "@/lib/loginThrottle";

export type LoginState = { error: string | null };

// Only allow redirects back into this app after login
function safeNext(value: FormDataEntryValue | null) {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function clientIp() {
    return headers().get("x-forwarded-for")?.split(",")[0].trim() || headers().get("x-real-ip") || "unknown";
}

export async function Login(_: LoginState, formData: FormData): Promise<LoginState> {
    const ip = clientIp();
    if (isLockedOut(ip)) {
        return {error: "Too many wrong passwords. Try again in 15 minutes."};
    }

    const password = formData.get("password");
    const valid = typeof password === "string" && password.length > 0
        && await verifyPassword(password, process.env.PENNYWISE_PASSWORD_HASH);

    if (!valid) {
        recordFailure(ip);
        console.warn(`Failed Pennywise login from ${ip}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {error: "Wrong password"};
    }

    clearFailures(ip);
    cookies().set(SESSION_COOKIE, await createSessionToken(), {
        httpOnly: true,
        // Browsers drop Secure cookies over plain HTTP, so local testing of a production build can opt out
        secure: process.env.NODE_ENV === "production" && process.env.PENNYWISE_ALLOW_HTTP !== "true",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
    });
    redirect(safeNext(formData.get("next")));
}

export async function Logout() {
    cookies().delete(SESSION_COOKIE);
    redirect("/login");
}
