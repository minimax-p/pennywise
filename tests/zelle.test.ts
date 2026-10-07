import {describe, expect, it} from "vitest";
import {bankFromCode, isSelf, parseSelfNames, parseZelle} from "@/lib/import/zelle";

describe("parseZelle", () => {
    it("reads the person and confirmation code from Chase lines", () => {
        expect(parseZelle("Zelle payment to Test User JPM99cp7nm8d")).toEqual({direction: "to", name: "Test User", code: "JPM99cp7nm8d"});
        expect(parseZelle("Zelle payment from ALEX FRIEND 31088133579")).toEqual({direction: "from", name: "ALEX FRIEND", code: "31088133579"});
        expect(parseZelle("Zelle payment from TEST USER COF7P5Z7RRZO")).toMatchObject({name: "TEST USER", code: "COF7P5Z7RRZO"});
        expect(parseZelle("Zelle money received from Jo Lee")).toEqual({direction: "from", name: "Jo Lee", code: null});
        expect(parseZelle("WAL-MART #2131 MIDDLETOWN NY")).toBeNull();
    });

    it("names the sending bank from the code", () => {
        expect(bankFromCode("COF7P5Z7RRZO")).toBe("Capital One");
        expect(bankFromCode("BACg1p4sulwi")).toBe("Bank of America");
        expect(bankFromCode("31088133579")).toBeNull();
        expect(bankFromCode(null)).toBeNull();
    });
});

describe("isSelf", () => {
    it("matches every word of one of your names, ignoring case and order", () => {
        const names = parseSelfNames("Huu Nhat Minh Pham, Minh");
        // A single word is too loose to match on
        expect(names).toEqual([["HUU", "NHAT", "MINH", "PHAM"]]);
        expect(isSelf("HUU NHAT MINH PHAM", names)).toBe(true);
        expect(isSelf("Pham Huu Nhat Minh", names)).toBe(true);
        expect(isSelf("LAN PHUONG PHAM", names)).toBe(false);
        expect(isSelf("MINH", names)).toBe(false);
        expect(isSelf("Anyone", parseSelfNames(null))).toBe(false);
    });
});
