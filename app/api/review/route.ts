import {requireUser} from "@/lib/actionResult";
import {getSortQueue} from "@/lib/sortQueue";

export const dynamic = "force-dynamic";

export async function GET() {
    const user = await requireUser();
    return Response.json(await getSortQueue(user.id));
}
