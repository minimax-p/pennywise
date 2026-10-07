import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

// Number shown next to Sort in the navigation
export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    const count = await prisma.transaction.count({
        where: {userId: user.id, needsReview: true, type: {in: ["income", "expense"]}},
    });
    return Response.json({count});
}
