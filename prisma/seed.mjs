// Adds the built-in categories (prisma/categories.mjs). Run with `npx prisma db seed`; deploy.sh
// runs it after every update. Safe to run again: categories that exist are left as they are,
// including ones you renamed, regrouped or hid.
import {PrismaClient} from "@prisma/client";
import {CATEGORIES} from "./categories.mjs";

const prisma = new PrismaClient();

async function main() {
    let created = 0;
    for (const {key, name, icon, type, group, sortOrder} of CATEGORIES) {
        if (await prisma.category.findUnique({where: {key}})) continue;
        // A built-in category from before keys, with the same name, becomes this one
        const unkeyed = await prisma.category.findFirst({where: {name, type, isUniversal: true, key: null}});
        if (unkeyed) {
            await prisma.category.update({where: {id: unkeyed.id}, data: {key, icon, group, sortOrder}});
        } else {
            await prisma.category.create({data: {key, name, icon, type, group, sortOrder, isUniversal: true}});
            created++;
        }
    }
    console.log(`Added ${created} built-in categories (${CATEGORIES.length - created} already there)`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
