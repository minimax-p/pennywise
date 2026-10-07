import type {Transaction as PlaidTransaction} from "plaid";
import {TransactionType} from "@/lib/types";

// Converts Plaid transactions into Pennywise transactions.
// Plaid categories: https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv

// Money moving between the user's own accounts. Importing these would count the same money twice.
const SKIPPED_PRIMARY_CATEGORIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);
const SKIPPED_DETAILED_CATEGORIES = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);

// Plaid detailed category -> key of a built-in category (see prisma/categories.mjs)
export const PLAID_DETAILED_CATEGORY_MAP: Record<string, string> = {
    FOOD_AND_DRINK_RESTAURANT: "eating-out",
    FOOD_AND_DRINK_GROCERIES: "groceries",
    FOOD_AND_DRINK_COFFEE: "coffee-snacks",
    FOOD_AND_DRINK_FAST_FOOD: "eating-out",
    FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "eating-out",
    FOOD_AND_DRINK_VENDING_MACHINES: "coffee-snacks",

    TRANSPORTATION_GAS: "gas",
    TRANSPORTATION_PUBLIC_TRANSIT: "rides",
    TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "rides",
    TRANSPORTATION_BIKES_AND_SCOOTERS: "rides",
    TRANSPORTATION_PARKING: "car",
    TRANSPORTATION_TOLLS: "car",
    TRAVEL_RENTAL_CARS: "travel",
    LOAN_PAYMENTS_CAR_PAYMENT: "car",
    GENERAL_SERVICES_AUTOMOTIVE: "car",

    RENT_AND_UTILITIES_RENT: "rent",
    LOAN_PAYMENTS_MORTGAGE_PAYMENT: "rent",
    RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "utilities",
    RENT_AND_UTILITIES_WATER: "utilities",
    RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: "utilities",
    RENT_AND_UTILITIES_TELEPHONE: "utilities",
    RENT_AND_UTILITIES_OTHER_UTILITIES: "utilities",
    RENT_AND_UTILITIES_INTERNET_AND_CABLE: "phone-internet",
    HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE: "household",
    HOME_IMPROVEMENT_HARDWARE: "household",
    HOME_IMPROVEMENT_FURNITURE: "household",
    HOME_IMPROVEMENT_SECURITY: "household",
    PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: "household",

    ENTERTAINMENT_TV_AND_MOVIES: "fun",
    ENTERTAINMENT_MUSIC_AND_AUDIO: "subscriptions",
    ENTERTAINMENT_VIDEO_GAMES: "fun",
    ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: "fun",

    GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: "shopping",
    GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "shopping",
    GENERAL_MERCHANDISE_ELECTRONICS: "shopping",
    GENERAL_MERCHANDISE_PET_SUPPLIES: "household",
    GENERAL_MERCHANDISE_SPORTING_GOODS: "shopping",
    MEDICAL_VETERINARY_SERVICES: "household",

    PERSONAL_CARE_HAIR_AND_BEAUTY: "personal-care",
    PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "health",
    MEDICAL_DENTAL_CARE: "health",
    MEDICAL_EYE_CARE: "health",
    MEDICAL_PRIMARY_CARE: "health",
    MEDICAL_PHARMACIES_AND_SUPPLEMENTS: "health",

    INCOME_WAGES: "paycheck",
    INCOME_DIVIDENDS: "interest",
    INCOME_INTEREST_EARNED: "interest",
    INCOME_RETIREMENT_PENSION: "interest",
};

// Used when the detailed category has no match
export const PLAID_PRIMARY_CATEGORY_MAP: Record<string, string> = {
    FOOD_AND_DRINK: "eating-out",
    GENERAL_MERCHANDISE: "shopping",
    RENT_AND_UTILITIES: "utilities",
    HOME_IMPROVEMENT: "household",
    MEDICAL: "health",
    PERSONAL_CARE: "health",
};

export type ConvertedPlaidTransaction = {
    plaidTransactionId: string;
    amount: number;
    type: TransactionType;
    date: Date;
    description: string;
    // Key of the built-in category to file it under, null when there is no match
    categoryKey: string | null;
};

// Returns null for transactions that should not be imported
export function convertPlaidTransaction(transaction: PlaidTransaction): ConvertedPlaidTransaction | null {
    // Pending transactions come back with a new id once they post
    if (transaction.pending) return null;

    const pfc = transaction.personal_finance_category;
    if (pfc && (SKIPPED_PRIMARY_CATEGORIES.has(pfc.primary) || SKIPPED_DETAILED_CATEGORIES.has(pfc.detailed))) {
        return null;
    }

    const amount = Math.round(Math.abs(transaction.amount) * 100) / 100;
    if (amount === 0) return null;

    const categoryKey = pfc
        ? PLAID_DETAILED_CATEGORY_MAP[pfc.detailed] ?? PLAID_PRIMARY_CATEGORY_MAP[pfc.primary] ?? null
        : null;

    return {
        plaidTransactionId: transaction.transaction_id,
        amount,
        // Plaid amounts are positive when money leaves the account
        type: transaction.amount > 0 ? "expense" : "income",
        date: new Date(`${transaction.date}T00:00:00.000Z`),
        // Fits the default VARCHAR(191) column
        description: (transaction.merchant_name || transaction.name || "").slice(0, 191),
        categoryKey,
    };
}
