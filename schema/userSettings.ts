import z from 'zod';
import {Currencies} from "@/lib/currencies";

export const UpdateUserCurrencySchema = z.object({
    currency: z.custom(value=>{
        const found = Currencies.some((c)=> c.value === value);
        if (!found) {
            throw new Error(`Invalid currency: ${value}`);
        }

        return value;
    })
});
// Your name as banks print it on Zelle payments; several separated by commas
export const UpdateSelfNamesSchema = z.object({
    selfNames: z.string().trim().max(191).transform((v) => v || null),
});
