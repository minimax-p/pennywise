import {AuthenticationError, choice, PermissionDeniedError, TypeSafeClient} from "@typesafe-ai/sdk";

// Asks Jev (TypeSafe AI's classification model) which of your categories a transaction
// belongs to. Used only when TYPESAFE_API_KEY is set, and only for merchants your own
// past choices and the bank's categories don't cover.

// A category Jev is at least this sure of is filed without asking you
export const AUTO_ACCEPT_CONFIDENCE = 0.8;

const CONCURRENCY = 6;
const MAX_PAST_CHOICES = 40;
// Jev accepts up to 255 options per question
const MAX_OPTIONS = 255;

export function jevEnabled() {
    return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

export type CategoryOption = { name: string, group: string | null };
export type PastChoice = { merchant: string, category: string };

export type JevRequest = {
    description: string;
    // Positive when money came in
    amount: number;
    date: Date;
    accountName: string | null;
    accountType: string | null;
    bankCategory: string | null;
};

export type Alternative = { name: string, probability: number };
export type JevSuggestion = { name: string, confidence: number, alternatives: Alternative[] };

export type JevContext = {
    categories: { income: CategoryOption[], expense: CategoryOption[] };
    pastChoices: { income: PastChoice[], expense: PastChoice[] };
};

async function askOne(client: TypeSafeClient, request: JevRequest, context: JevContext): Promise<JevSuggestion | null> {
    const income = request.amount > 0;
    const options = (income ? context.categories.income : context.categories.expense).slice(0, MAX_OPTIONS);
    if (options.length < 2) return null;

    const criteria = Object.fromEntries(options.map((c) => [c.name, c.group ? `${c.group}: ${c.name}` : null]));
    const {answers} = await client.systemOne({
        state: {
            transaction: {
                description: request.description,
                amount: Math.abs(request.amount),
                direction: income ? "money received" : "money spent",
                date: request.date.toISOString().slice(0, 10),
                account: request.accountName
                    ? `${request.accountName}${request.accountType ? ` (${request.accountType})` : ""}`
                    : null,
                bank_category: request.bankCategory,
            },
            past_choices: (income ? context.pastChoices.income : context.pastChoices.expense).slice(0, MAX_PAST_CHOICES),
        },
        questions: {
            category: choice(
                `Which ${income ? "income" : "spending"} category fits this bank transaction best? `
                + "When a past choice is for the same or a similar merchant, follow it.",
                criteria,
            ),
        },
    });

    const answer = answers.category;
    if (!options.some((c) => c.name === answer.choice)) return null;
    const alternatives = Object.entries(answer.probabilities as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, probability]) => ({name, probability: Math.round(probability * 1000) / 1000}));
    return {name: answer.choice, confidence: answer.confidence, alternatives};
}

// One answer per request, null where Jev is off, unsure of the format, or unreachable.
// Failures never throw: sorting falls back to the Sort page.
export async function askJev(requests: JevRequest[], context: JevContext): Promise<(JevSuggestion | null)[]> {
    const results: (JevSuggestion | null)[] = requests.map(() => null);
    if (!jevEnabled() || requests.length === 0) return results;

    const client = new TypeSafeClient({timeout: 8000, retry: {maxRetries: 1}});
    let next = 0;
    let stopped = false;

    async function worker() {
        while (!stopped && next < requests.length) {
            const index = next++;
            try {
                results[index] = await askOne(client, requests[index], context);
            } catch (error) {
                if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
                    // Every other call would fail the same way
                    stopped = true;
                    console.error("Jev rejected TYPESAFE_API_KEY; skipping AI sorting");
                } else {
                    console.warn("Jev could not sort a transaction:", error instanceof Error ? error.message : error);
                }
            }
        }
    }

    await Promise.all(Array.from({length: Math.min(CONCURRENCY, requests.length)}, worker));
    return results;
}
