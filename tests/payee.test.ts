import {describe, expect, it} from "vitest";
import {payeeKey, payeesSimilar, payeeTokens} from "@/lib/payee";

describe("payeeKey", () => {
    it.each([
        ["STARBUCKS STORE 12345 SEATTLE WA", "STARBUCKS"],
        ["Starbucks", "STARBUCKS"],
        ["SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA", "BLUE BOTTLE"],
        ["TST* JOE'S PIZZA NEW YORK NY", "JOE PIZZA"],
        ["POS DEBIT CARD PURCHASE WHOLEFDS MKT 10234", "WHOLEFDS MKT"],
        ["AMAZON.COM*2K3L45 AMZN.COM/BILL WA", "AMAZON"],
        ["STARBUCKS STORE 678 BELLEVUE WA", "STARBUCKS"],
        ["H&M", "H&M"],
    ])("%s -> %s", (description, key) => {
        expect(payeeKey(description)).toBe(key);
    });

    it("returns null when there is nothing to go on", () => {
        expect(payeeKey("#1234 5678")).toBeNull();
        expect(payeeTokens("")).toEqual([]);
    });
});

describe("payeesSimilar", () => {
    it("matches an Apple Pay merchant name with the bank's description", () => {
        expect(payeesSimilar("Starbucks", "STARBUCKS STORE 12345 SEATTLE WA")).toBe(true);
        expect(payeesSimilar("Blue Bottle Coffee", "SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA")).toBe(true);
        expect(payeesSimilar("Trader Joe's", "TRADER JOE S #552 SAN FRANCISCO CA")).toBe(true);
    });

    it("does not match different merchants", () => {
        expect(payeesSimilar("Starbucks", "PEET'S COFFEE")).toBe(false);
        expect(payeesSimilar("", "PEET'S COFFEE")).toBe(false);
    });
});
