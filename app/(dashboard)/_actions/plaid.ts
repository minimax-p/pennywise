"use server";

import {ActionResult, requireUser} from "@/lib/actionResult";
import {LinkTokenCreateRequest, Products} from "plaid";
import prisma from "@/lib/prisma";
import {getPlaidError, plaidClient, plaidCountryCodes} from "@/lib/plaid";
import {decryptSecret, encryptSecret} from "@/lib/crypto";
import {PlaidSyncResult, syncPlaidItem} from "@/lib/plaidSync";
import {UnlinkPlaidItemSchema, UnlinkPlaidItemSchemaType} from "@/schema/plaid";

function plaidErrorResult(error: unknown): { ok: false, error: string } {
    const plaidError = getPlaidError(error);
    if (!plaidError) throw error;
    console.error("Plaid error:", plaidError.error_code, plaidError.error_message);
    return {ok: false, error: plaidError.display_message || plaidError.error_message};
}

// Pass an itemId to reconnect an existing bank connection (Plaid Link update mode)
export async function CreatePlaidLinkToken(itemId?: string): Promise<ActionResult<{ linkToken: string }>> {
    const user = await requireUser();

    // Fail before the user links a bank whose access token could not be stored
    try {
        encryptSecret("check");
    } catch (error) {
        console.error(error);
        return {ok: false, error: "Bank linking is not set up: PLAID_TOKEN_ENCRYPTION_KEY is missing or invalid"};
    }

    const request: LinkTokenCreateRequest = {
        user: {client_user_id: user.id},
        client_name: "Pennywise",
        country_codes: plaidCountryCodes,
        language: "en",
    };

    if (itemId) {
        const item = await prisma.plaidItem.findFirst({where: {id: itemId, userId: user.id}});
        if (!item) return {ok: false, error: "Bank connection not found"};
        request.access_token = decryptSecret(item.accessToken);
    } else {
        request.products = [Products.Transactions];
        request.transactions = {days_requested: 365};
    }

    try {
        const {data} = await plaidClient.linkTokenCreate(request);
        return {ok: true, data: {linkToken: data.link_token}};
    } catch (error) {
        return plaidErrorResult(error);
    }
}

async function getInstitution(accessToken: string) {
    try {
        const {data: {item}} = await plaidClient.itemGet({access_token: accessToken});
        if (!item.institution_id) return {id: null, name: null};
        const {data: {institution}} = await plaidClient.institutionsGetById({
            institution_id: item.institution_id,
            country_codes: plaidCountryCodes,
        });
        return {id: item.institution_id, name: institution.name};
    } catch (error) {
        // The name is only used as a label, so linking still succeeds without it
        console.error("Could not look up institution:", getPlaidError(error)?.error_code ?? error);
        return {id: null, name: null};
    }
}

const INITIAL_SYNC_ATTEMPTS = 5;
const INITIAL_SYNC_DELAY_MS = 2000;

export async function ExchangePlaidPublicToken(publicToken: string): Promise<ActionResult<PlaidSyncResult>> {
    const user = await requireUser();

    let accessToken: string;
    let plaidItemId: string;
    try {
        const {data} = await plaidClient.itemPublicTokenExchange({public_token: publicToken});
        accessToken = data.access_token;
        plaidItemId = data.item_id;
    } catch (error) {
        return plaidErrorResult(error);
    }

    const institution = await getInstitution(accessToken);

    // A second connection to the same bank would import every transaction twice
    if (institution.id) {
        const duplicate = await prisma.plaidItem.findFirst({
            where: {userId: user.id, institutionId: institution.id},
        });
        if (duplicate) {
            await plaidClient.itemRemove({access_token: accessToken}).catch(() => undefined);
            return {ok: false, error: `${institution.name ?? "This bank"} is already linked. Use Sync or Reconnect on the existing connection.`};
        }
    }

    const item = await prisma.plaidItem.create({
        data: {
            userId: user.id,
            itemId: plaidItemId,
            accessToken: encryptSecret(accessToken),
            institutionId: institution.id,
            institutionName: institution.name,
        },
    });

    // Plaid needs a few seconds after linking before the first transactions are available
    let result = await syncPlaidItem(item);
    for (let attempt = 1; attempt < INITIAL_SYNC_ATTEMPTS && result.notReady && !result.error; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, INITIAL_SYNC_DELAY_MS));
        result = await syncPlaidItem(await prisma.plaidItem.findUniqueOrThrow({where: {id: item.id}}));
    }

    return {ok: true, data: result};
}

// Syncs one bank connection, or all of the user's connections when no id is given
export async function SyncPlaidItems(itemId?: string): Promise<ActionResult<PlaidSyncResult[]>> {
    const user = await requireUser();

    const items = await prisma.plaidItem.findMany({
        where: {userId: user.id, ...(itemId && {id: itemId})},
        orderBy: {createdAt: 'asc'},
    });
    if (itemId && items.length === 0) {
        return {ok: false, error: "Bank connection not found"};
    }

    const results: PlaidSyncResult[] = [];
    for (const item of items) {
        results.push(await syncPlaidItem(item));
    }
    return {ok: true, data: results};
}

export async function UnlinkPlaidItem(form: UnlinkPlaidItemSchemaType): Promise<ActionResult<{ deletedTransactions: number }>> {
    const parsedBody = UnlinkPlaidItemSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error("UnlinkPlaidItemSchema: Invalid form data");
    }
    const user = await requireUser();
    const {id, deleteTransactions} = parsedBody.data;

    const item = await prisma.plaidItem.findFirst({where: {id, userId: user.id}});
    if (!item) return {ok: false, error: "Bank connection not found"};

    let accessToken: string | null = null;
    try {
        accessToken = decryptSecret(item.accessToken);
    } catch (error) {
        // Encrypted with a key that has since changed, so it can only be removed here
        console.error("Could not decrypt Plaid access token:", error);
    }

    if (accessToken) {
        try {
            await plaidClient.itemRemove({access_token: accessToken});
        } catch (error) {
            // Already gone on Plaid's side, so it only needs removing here
            const code = getPlaidError(error)?.error_code;
            if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") {
                return plaidErrorResult(error);
            }
        }
    }

    const deletedTransactions = await prisma.$transaction(async (tx) => {
        let deleted = 0;
        if (deleteTransactions) {
            const imported = await tx.transaction.findMany({where: {plaidItemId: item.id, userId: user.id}});
            await tx.transaction.deleteMany({where: {id: {in: imported.map((t) => t.id)}}});
            deleted = imported.length;
        }
        // Kept transactions stay as regular transactions (plaidItemId is set to null)
        await tx.plaidItem.delete({where: {id: item.id}});
        return deleted;
    }, {maxWait: 10_000, timeout: 60_000});

    return {ok: true, data: {deletedTransactions}};
}
