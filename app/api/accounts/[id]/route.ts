import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import z from "zod";
import {getAccountPage} from "@/lib/accountPage";

export async function GET(request: Request, {params}: { params: { id: string } }) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const days = z.coerce.number().int().min(0).max(36500).catch(90).parse(new URL(request.url).searchParams.get('days') ?? 90);
    const page = await getAccountPage(user.id, params.id, days);
    if (!page) {
        return Response.json({error: "Account not found"}, {status: 404});
    }
    return Response.json(page);
}
