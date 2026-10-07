import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import {applyMapping, fingerprintRows, guessMapping, parseAmount, parseDate, parseFile} from "@/lib/import/parse";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function importCsv(name: string, accountType: string) {
    const parsed = parseFile(fixture(name));
    if (parsed.format !== "csv") throw new Error("expected csv");
    const mapping = guessMapping(parsed.headers, parsed.records, accountType);
    return {mapping, ...applyMapping(parsed.headers, parsed.records, mapping)};
}

describe("parseAmount", () => {
    it.each([
        ["-4.50", -4.5], ["$1,234.56", 1234.56], ["(12.00)", -12], ["- $40.00", -40], ["+ $15.00", 15],
        ["12.00-", -12], ["0.10", 0.1], [" 7 ", 7],
    ])("%s -> %s", (text, amount) => {
        expect(parseAmount(text)).toBe(amount);
    });

    it.each(["", "abc", "1.2.3", undefined])("rejects %s", (text) => {
        expect(parseAmount(text)).toBeNull();
    });
});

describe("parseDate", () => {
    it.each([
        ["10/05/2026", "2026-10-05"], ["10/5/26", "2026-10-05"], ["2026-10-05", "2026-10-05"],
        ["2026-10-05T18:22:10", "2026-10-05"], ["20261005120000[0:GMT]", "2026-10-05"],
    ])("%s -> %s", (text, iso) => {
        expect(parseDate(text)).toEqual(day(iso));
    });

    it.each(["13/01/2026", "02/30/2026", "yesterday", ""])("rejects %s", (text) => {
        expect(parseDate(text)).toBeNull();
    });
});

describe("bank formats", () => {
    it("reads Chase checking CSVs", () => {
        const {mapping, rows} = importCsv("chase-checking.csv", "checking");
        expect(mapping.preset).toBe("chase-checking");
        expect(rows).toHaveLength(4);
        expect(rows[0]).toMatchObject({date: day("2026-10-03"), amount: -4.5, description: "STARBUCKS STORE 12345 SEATTLE WA"});
        expect(rows[1].amount).toBe(2500);
    });

    it("reads Discover CSVs with purchases as positive numbers", () => {
        const {mapping, rows} = importCsv("discover.csv", "credit");
        expect(mapping).toMatchObject({preset: "discover", invertSign: true});
        expect(rows.map((r) => r.amount)).toEqual([300, -54.21, -6.75, -45.1]);
        expect(rows[1]).toMatchObject({date: day("2026-10-05"), bankCategory: "Supermarkets"});
    });

    it("reads Capital One 360 CSVs with a Debit/Credit column", () => {
        const {mapping, rows} = importCsv("capital-one-360.csv", "savings");
        expect(mapping.preset).toBe("capital-one-bank");
        expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.amount])).toEqual([["2026-10-05", 500], ["2026-09-30", 12.34]]);
    });

    it("reads Venmo statements, skipping title lines, pending payments and bank-funded payments", () => {
        const {mapping, rows, skipped} = importCsv("venmo.csv", "cash");
        expect(mapping.preset).toBe("venmo");
        expect(rows.map((r) => [r.amount, r.description, r.externalId])).toEqual([
            [-40, "Jane Seller: couch", "4001"],
            [15, "Sam Friend: pizza split", "4002"],
            [-12, "Sam Friend: tacos", "4003"],
        ]);
        expect(rows[0].skipReason).toMatch(/Paid from Chase Debit/);
        expect(rows[1].skipReason).toBeNull();
        expect(rows[2].skipReason).toBeNull();
        // The balance lines and the pending payment
        expect(skipped).toBe(3);
    });

    it("reads QFX files with ids and entities", () => {
        const parsed = parseFile(fixture("chase.qfx"));
        expect(parsed.format).toBe("ofx");
        if (parsed.format !== "ofx") return;
        expect(parsed.rows).toEqual([
            {date: day("2026-10-03"), amount: -4.5, description: "STARBUCKS STORE 12345 SEATTL", externalId: "202610030", bankCategory: null, skipReason: null},
            {date: day("2026-10-01"), amount: 2500, description: "ACME CORP PAYROLL & BENEFITS", externalId: "202610010", bankCategory: null, skipReason: null},
        ]);
    });

    it("reads XML OFX files", () => {
        const xml = `<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
            <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261005</DTPOSTED><TRNAMT>-54.21</TRNAMT><FITID>abc</FITID><NAME>TRADER JOE S</NAME></STMTTRN>
            </BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
        const parsed = parseFile(xml);
        expect(parsed.format === "ofx" && parsed.rows).toEqual([
            {date: day("2026-10-05"), amount: -54.21, description: "TRADER JOE S", externalId: "abc", bankCategory: null, skipReason: null},
        ]);
    });

    it("guesses columns for unknown CSVs", () => {
        const csv = "Date,Payee,Withdrawal,Deposit\n2026-10-01,Rent,1200.00,\n2026-10-02,Refund,,25.00\n";
        const parsed = parseFile(csv);
        if (parsed.format !== "csv") throw new Error("expected csv");
        const mapping = guessMapping(parsed.headers, parsed.records, "checking");
        expect(mapping).toMatchObject({date: "Date", description: "Payee", debit: "Withdrawal", credit: "Deposit"});
        expect(applyMapping(parsed.headers, parsed.records, mapping).rows.map((r) => r.amount)).toEqual([-1200, 25]);
    });

    it("explains files that are not statements", () => {
        expect(() => parseFile("hello,world\n1,2\n")).toThrow(/column headers/);
    });
});

describe("fingerprintRows", () => {
    it("is stable across files and tells identical same-day lines apart", () => {
        const row = {date: day("2026-10-03"), amount: -4.5, description: "STARBUCKS", externalId: null, bankCategory: null, skipReason: null};
        const [a, b] = fingerprintRows([row, {...row}]);
        expect(a).not.toBe(b);
        expect(fingerprintRows([{...row, description: "  starbucks "}])[0]).toBe(a);
        expect(fingerprintRows([{...row, externalId: "X1"}])[0]).toBe("id:X1");
    });
});
