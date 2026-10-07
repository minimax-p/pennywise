import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import z from "zod";

export async function GET(request: Request){
    const user = await currentUser();
    if(!user){
        redirect('/login');
    }

    const {searchParams} = new URL(request.url);
    const paramType = searchParams.get('type');

    const validator = z.enum(['income', 'expense']).nullable();
    const queryParams=validator.safeParse(paramType);
    if (!queryParams.success){
        return Response.json(queryParams.error, {status: 400});
    }

    const type =queryParams.data;
    const categories = await prisma.category.findMany({
        where: {
            OR: [
                { userId: user.id },
                { userId: null }
            ],
            ...(type && { type }), // include type in the filters if it's defined
        },
        orderBy: [{sortOrder: 'asc'}, {name: 'asc'}],
    });

    return Response.json(categories)
}