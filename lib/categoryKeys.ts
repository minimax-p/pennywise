import {Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {CATEGORIES, SYSTEM_KEYS} from "@/prisma/categories.mjs";

// Built-in categories by their stable key (prisma/categories.mjs), so code keeps finding
// them after you rename one

type Db = Prisma.TransactionClient;

export type CategoryKey = typeof CATEGORIES[number]["key"];

export function isSystemCategory(category: { key: string | null }) {
    return Boolean(category.key && (SYSTEM_KEYS as readonly string[]).includes(category.key));
}

// The category with this key, created from the built-in list if it's missing
export async function categoryByKey(key: CategoryKey, db: Db = prisma) {
    const existing = await db.category.findUnique({where: {key}});
    if (existing) return existing;
    const definition = CATEGORIES.find((c) => c.key === key)!;
    return db.category.upsert({
        where: {key},
        update: {},
        create: {
            key, name: definition.name, icon: definition.icon, type: definition.type, group: definition.group,
            sortOrder: definition.sortOrder, isUniversal: true,
        },
    });
}
