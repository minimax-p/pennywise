"use server";

import z from "zod";
import {ActionResult, requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";

const name = z.string().trim().min(1, "Type a name").max(80);

export async function RenamePerson(id: string, newName: string): Promise<ActionResult<null>> {
    const parsed = name.safeParse(newName);
    if (!parsed.success) return {ok: false, error: parsed.error.issues[0].message};
    const user = await requireUser();
    const person = await prisma.person.findFirst({where: {id, userId: user.id}});
    if (!person) return {ok: false, error: "Person not found"};
    const taken = await prisma.person.findFirst({
        where: {userId: user.id, name: {equals: parsed.data, mode: "insensitive"}, NOT: {id}},
    });
    if (taken) return {ok: false, error: `${taken.name} is already someone. Merge them instead.`};
    await prisma.person.update({where: {id}, data: {name: parsed.data}});
    return {ok: true, data: null};
}

// Two spellings of the same person become one; everything with them moves over
export async function MergePeople(fromId: string, intoId: string): Promise<ActionResult<null>> {
    const user = await requireUser();
    if (fromId === intoId) return {ok: false, error: "Pick someone else"};
    const [from, into] = await Promise.all([
        prisma.person.findFirst({where: {id: fromId, userId: user.id}}),
        prisma.person.findFirst({where: {id: intoId, userId: user.id}}),
    ]);
    if (!from || !into) return {ok: false, error: "Person not found"};
    await prisma.$transaction([
        prisma.transaction.updateMany({where: {personId: from.id}, data: {personId: into.id}}),
        prisma.transactionLine.updateMany({where: {personId: from.id}, data: {personId: into.id}}),
        prisma.person.update({
            where: {id: into.id},
            data: {aliases: [...new Set([...into.aliases, ...from.aliases])]},
        }),
        prisma.person.delete({where: {id: from.id}}),
    ]);
    return {ok: true, data: null};
}

// Only someone without shares in a split can be removed; their payments keep their text
export async function DeletePerson(id: string): Promise<ActionResult<null>> {
    const user = await requireUser();
    const person = await prisma.person.findFirst({where: {id, userId: user.id}, include: {_count: {select: {lines: true}}}});
    if (!person) return {ok: false, error: "Person not found"};
    if (person._count.lines > 0) return {ok: false, error: "They have shares in splits. Merge them into someone instead."};
    await prisma.person.delete({where: {id}});
    return {ok: true, data: null};
}
