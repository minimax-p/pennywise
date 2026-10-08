import {NextRequest, NextResponse} from "next/server";
import {SESSION_COOKIE, verifySessionToken} from "@/lib/session";

// Reachable without a session. /api/capture checks its own device keys; /api/health
// says only whether the app and its database are up.
const PUBLIC_PATHS = ["/login", "/api/capture", "/api/health", "/manifest.webmanifest"];

export async function middleware(request: NextRequest) {
    const {pathname, search} = request.nextUrl;
    if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
        return NextResponse.next();
    }

    if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
        return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
        return NextResponse.json({error: "Unauthorized"}, {status: 401});
    }

    // Built from the Host header, so the browser stays on the domain it asked for. Behind nginx with
    // HOSTNAME=127.0.0.1, request.url carries the app's own address (https://localhost:3200) instead.
    const host = request.headers.get("host") ?? request.nextUrl.host;
    const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    const loginUrl = new URL("/login", `${protocol}://${host}`);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    // Skip Next.js internals and static files
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$).*)'],
};
