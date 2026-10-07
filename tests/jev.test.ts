import {afterEach, describe, expect, it} from "vitest";
import {askJev, JevContext, JevRequest} from "@/lib/categorize/jev";
import {startFakeJev} from "./fakeJev";

const context: JevContext = {
    categories: {
        expense: [
            {name: "Coffee Shops", group: "Food & Dining"},
            {name: "Groceries", group: "Food & Dining"},
            {name: "Gas", group: "Transportation"},
            {name: "Plants", group: null},
        ],
        income: [{name: "Salary", group: "Income"}, {name: "Freelance", group: "Income"}],
    },
    pastChoices: {expense: [{merchant: "STARBUCKS", category: "Coffee Shops"}], income: []},
};

const coffee: JevRequest = {
    description: "SQ *BLUE BOTTLE COFFEE", amount: -6.75, date: new Date("2026-10-06T00:00:00Z"),
    accountName: "Discover it", accountType: "credit", bankCategory: "Restaurants",
};

describe("askJev", () => {
    let stop: (() => Promise<void>) | null = null;
    afterEach(async () => {
        await stop?.();
        stop = null;
    });

    it("does nothing without an API key", async () => {
        delete process.env.TYPESAFE_API_KEY;
        expect(await askJev([coffee], context)).toEqual([null]);
    });

    it("asks a choice question over your categories and returns the top answers", async () => {
        const fake = await startFakeJev((_, labels) => ({choice: "Coffee Shops", confidence: 0.91}));
        stop = fake.stop;

        const [answer] = await askJev([coffee], context);
        expect(answer).toEqual({
            name: "Coffee Shops",
            confidence: 0.91,
            alternatives: [
                {name: "Coffee Shops", probability: 0.91},
                {name: "Groceries", probability: 0.03},
                {name: "Gas", probability: 0.03},
            ],
        });

        expect(fake.requests).toHaveLength(1);
        const {path, authorization, body} = fake.requests[0];
        expect(path).toBe("/v1/systemone");
        expect(authorization).toBe("Bearer test-key");
        expect(body.model).toBe("jev-latest");
        expect(body.state).toEqual({
            transaction: {
                description: "SQ *BLUE BOTTLE COFFEE", amount: 6.75, direction: "money spent", date: "2026-10-06",
                account: "Discover it (credit)", bank_category: "Restaurants",
            },
            past_choices: [{merchant: "STARBUCKS", category: "Coffee Shops"}],
        });
        expect(body.questions.category.type).toBe("choice");
        expect(body.questions.category.criteria).toEqual({
            "Coffee Shops": "Food & Dining: Coffee Shops",
            "Groceries": "Food & Dining: Groceries",
            "Gas": "Transportation: Gas",
            "Plants": null,
        });
    });

    it("uses income categories for money coming in", async () => {
        const fake = await startFakeJev((_, labels) => ({choice: labels[1], confidence: 0.6}));
        stop = fake.stop;
        const [answer] = await askJev([{...coffee, description: "UPWORK PAYOUT", amount: 300}], context);
        expect(answer?.name).toBe("Freelance");
        expect(Object.keys(fake.requests[0].body.questions.category.criteria)).toEqual(["Salary", "Freelance"]);
        expect(fake.requests[0].body.state.transaction.direction).toBe("money received");
    });

    it("stops after the API key is rejected and never throws", async () => {
        const fake = await startFakeJev(() => ({status: 401}));
        stop = fake.stop;
        const answers = await askJev(Array.from({length: 20}, () => coffee), context);
        expect(answers.every((a) => a === null)).toBe(true);
        // Workers that already started finish their one request; nobody keeps going
        expect(fake.requests.length).toBeLessThanOrEqual(6);
    });

    it("gives up on one transaction when the service fails", async () => {
        const fake = await startFakeJev(() => ({status: 400}));
        stop = fake.stop;
        expect(await askJev([coffee], context)).toEqual([null]);
    });
});
