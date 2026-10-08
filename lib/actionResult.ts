import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";

// What server actions return: errors are values, so their messages reach the page
// (Next.js hides the message of an error thrown in production)
export type ActionResult<T> = { ok: true, data: T } | { ok: false, error: string };

export async function requireUser() {
    const user = await currentUser();
    if (!user) redirect("/login");
    return user;
}
