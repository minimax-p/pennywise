import {describe, expect, it} from "vitest";
import {Account} from "@prisma/client";
import {lineCents, newLine, splitEvenly, splitProblem} from "@/lib/split";
import {aliasOf, displayName, owedTotals} from "@/lib/people";
import {classifyRow} from "@/lib/classify";
import {mentionsSelf, parseSelfNames} from "@/lib/import/zelle";
import {cashMove, walletMove} from "@/lib/import/plan";
import {centsToAmount, pressKey} from "@/app/(dashboard)/_components/Keypad";

const groceries = {name: "Groceries", type: "expense" as const};

describe("splits", () => {
    it("lets the last line take whatever is left", () => {
        const lines = [newLine({category: groceries, amount: "52.10"}), newLine({category: {name: "Household", type: "expense"}, amount: "21.30"}),
            newLine({person: {name: "Alex"}})];
        expect(lineCents(lines, 86.4)).toEqual([5210, 2130, 1300]);
        expect(splitProblem(lines, 86.4)).toBeNull();
        expect(splitProblem(lines, 70)).toMatch(/can't add up to more/);
        expect(splitProblem([newLine({category: groceries})], 10)).toMatch(/Add another part/);
        expect(splitProblem([newLine({person: {name: "Alex"}})], 10)).toBeNull();
        expect(splitProblem([newLine({category: groceries, amount: "5"}), newLine({})], 10)).toMatch(/Pick a category or person/);
    });

    it("splits evenly, giving you the leftover cent", () => {
        const lines = splitEvenly(100, groceries, [{name: "Alex"}, {id: "p2", name: "Mia"}]);
        expect(lines.map((l) => [l.person?.name ?? l.category?.name, l.amount])).toEqual([["Alex", "33.33"], ["Mia", "33.33"], ["Groceries", ""]]);
        expect(lineCents(lines, 100)).toEqual([3333, 3333, 3334]);
    });

    it("counts only your shares as spending", () => {
        const line = (amount: number, type: string | null) => ({amount, category: type ? {type} : null});
        expect(classifyRow({type: "expense", amount: 90, category: {type: "split"}, lines: [line(30, "expense"), line(60, null)]}))
            .toEqual({spending: 30, income: 0});
        // Paid back: neither spending nor income
        expect(classifyRow({type: "income", amount: 30, category: {type: "split"}, lines: [line(30, null)]}))
            .toEqual({spending: 0, income: 0});
        expect(classifyRow({type: "income", amount: 25, category: {type: "expense"}})).toEqual({spending: -25, income: 0});
    });
});

describe("people", () => {
    it("reads names the way banks print them", () => {
        expect(displayName("ALEX NGUYEN")).toBe("Alex Nguyen");
        expect(displayName("  mary-jane o'neil ")).toBe("Mary-Jane O'Neil");
        expect(displayName("DeShawn McCoy")).toBe("DeShawn McCoy");
        expect(aliasOf("Alex  Nguyen")).toBe("ALEX NGUYEN");
        expect(aliasOf("ALEX NGUYEN.")).toBe("ALEX NGUYEN");
    });

    it("adds up what people owe you and what you owe", () => {
        expect(owedTotals(new Map([["a", 105], ["b", 30], ["c", -20], ["d", 0]]))).toEqual({owedToYou: 135, youOwe: 20, net: 115});
    });
});

describe("cash and wallets", () => {
    const account = (id: string, type: string, name: string, institution: string | null = null) =>
        ({id, type, name, institution} as Account);
    const chase = account("chase", "checking", "Chase checking", "Chase");
    const cash = account("cash", "cash", "Cash");
    const venmo = account("venmo", "wallet", "Venmo", "Venmo");
    const self = parseSelfNames("Huu Nhat Minh Pham");

    it("moves ATM cash into the wallet and cash deposits out of it", () => {
        expect(cashMove({description: "ATM WITHDRAWAL 10/05 123 MAIN ST", amount: -100}, chase, [cash, venmo])).toBe(cash);
        expect(cashMove({description: "NON-CHASE ATM WITHDRAW 1234", amount: -60}, chase, [cash])).toBe(cash);
        expect(cashMove({description: "ATM CASH DEPOSIT 10/05 ROUTE 17", amount: 50}, chase, [cash])).toBe(cash);
        // Fees and checks aren't cash in your wallet
        expect(cashMove({description: "NON-CHASE ATM FEE-WITH", amount: -3}, chase, [cash])).toBeUndefined();
        expect(cashMove({description: "ATM CHECK DEPOSIT 10/05", amount: 200}, chase, [cash])).toBeUndefined();
        expect(cashMove({description: "STARBUCKS", amount: -5}, chase, [cash])).toBeUndefined();
        // Recognized, but there's no Cash account to put it in
        expect(cashMove({description: "ATM WITHDRAWAL", amount: -20}, chase, [venmo])).toBeNull();
        // Only from bank accounts
        expect(cashMove({description: "ATM WITHDRAWAL", amount: -20}, cash, [chase])).toBeUndefined();
    });

    it("recognizes money moved to and from your own Venmo", () => {
        expect(mentionsSelf("VENMO*PHAM HUU NHAT MI VISA DIRECT NY", self)).toBe(true);
        expect(mentionsSelf("VENMO* Huu Nhat Minh P Visa Direct NY", self)).toBe(true);
        expect(mentionsSelf("VENMO PAYMENT 1023 NHAT TRAN", self)).toBe(false);
        expect(walletMove({description: "VENMO* Huu Nhat Minh P Visa Direct NY"}, [cash, venmo], self)).toBe(venmo);
        expect(walletMove({description: "VENMO PAYMENT ALEX FRIEND"}, [venmo], self)).toBeUndefined();
        expect(walletMove({description: "VENMO*PHAM HUU NHAT MI"}, [cash], self)).toBeNull();
    });
});

describe("number pad", () => {
    it("types amounts in cents", () => {
        const typed = ["8", "6", "4", "0"].reduce(pressKey, "");
        expect(centsToAmount(typed)).toBe(86.4);
        expect(centsToAmount(pressKey(typed, "back"))).toBe(8.64);
        expect(pressKey("", "0")).toBe("");
        expect(pressKey("12", "00")).toBe("1200");
        expect(pressKey("123456789", "1")).toBe("123456789");
    });
});
