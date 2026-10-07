import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {getHome} from "@/lib/home";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return Response.json(await getHome(user.id));
}
