import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Used by scripts/deploy.sh to know the new version is up and can reach its database
export async function GET() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return Response.json({ok: true, release: process.env.PENNYWISE_RELEASE ?? null});
    } catch {
        return Response.json({ok: false, error: "Database unavailable"}, {status: 503});
    }
}
