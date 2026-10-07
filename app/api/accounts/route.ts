import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {listAccounts} from "@/lib/accounts";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    return Response.json(await listAccounts(user.id));
}

export type GetAccountsResponseType = Awaited<ReturnType<typeof listAccounts>>
