import {requireUser} from "@/lib/actionResult";
import {getAutoSorted} from "@/lib/sortQueue";

export const dynamic = "force-dynamic";

export async function GET() {
    const user = await requireUser();
    return Response.json(await getAutoSorted(user.id));
}
