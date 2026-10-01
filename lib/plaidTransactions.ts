import type {Transaction as PlaidTransaction} from "plaid";
import {TransactionType} from "@/lib/types";

// Converts Plaid transactions into Pennywise transactions.
// Plaid categories: https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv

// Money moving between the user's own accounts. Importing these would count the same money twice.
const SKIPPED_PRIMARY_CATEGORIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);
const SKIPPED_DETAILED_CATEGORIES = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);

// Plaid detailed category -> name of a universal category (see prisma/seed.mjs)
export const PLAID_DETAILED_CATEGORY_MAP: Record<string, string> = {
    FOOD_AND_DRINK_RESTAURANT: "Restaurants",
    FOOD_AND_DRINK_GROCERIES: "Groceries",
    FOOD_AND_DRINK_COFFEE: "Coffee Shops",
    FOOD_AND_DRINK_FAST_FOOD: "Fast Food",
    FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "Bars & Pubs",
    FOOD_AND_DRINK_VENDING_MACHINES: "Snacks & Treats",

    TRANSPORTATION_GAS: "Gas",
    TRANSPORTATION_PUBLIC_TRANSIT: "Public Transit",
    TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "Taxi/Uber",
    TRANSPORTATION_BIKES_AND_SCOOTERS: "Bike Rentals",
    TRANSPORTATION_PARKING: "Parking Fees",
    TRANSPORTATION_TOLLS: "Toll Fees",
    TRAVEL_RENTAL_CARS: "Car Rentals",
    LOAN_PAYMENTS_CAR_PAYMENT: "Car Payments",
    GENERAL_SERVICES_AUTOMOTIVE: "Vehicle Maintenance",

    RENT_AND_UTILITIES_RENT: "Rent/Mortgage",
    LOAN_PAYMENTS_MORTGAGE_PAYMENT: "Rent/Mortgage",
    RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "Utilities",
    RENT_AND_UTILITIES_WATER: "Utilities",
    RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: "Utilities",
    RENT_AND_UTILITIES_TELEPHONE: "Utilities",
    RENT_AND_UTILITIES_OTHER_UTILITIES: "Utilities",
    RENT_AND_UTILITIES_INTERNET_AND_CABLE: "Internet",
    HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE: "Maintenance",
    HOME_IMPROVEMENT_HARDWARE: "Maintenance",
    HOME_IMPROVEMENT_FURNITURE: "Home Furnishings",
    HOME_IMPROVEMENT_SECURITY: "Home Security",
    PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: "Cleaning Services",

    ENTERTAINMENT_TV_AND_MOVIES: "Movies",
    ENTERTAINMENT_MUSIC_AND_AUDIO: "Music",
    ENTERTAINMENT_VIDEO_GAMES: "Games",
    ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: "Events & Concerts",

    GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: "Books",
    GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "Clothing",
    GENERAL_MERCHANDISE_ELECTRONICS: "Electronics",
    GENERAL_MERCHANDISE_PET_SUPPLIES: "Pets",
    GENERAL_MERCHANDISE_SPORTING_GOODS: "Sports & Fitness Gear",
    MEDICAL_VETERINARY_SERVICES: "Pets",

    PERSONAL_CARE_HAIR_AND_BEAUTY: "Beauty & Grooming",
    PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "Gym",
    MEDICAL_DENTAL_CARE: "Dental Care",
    MEDICAL_EYE_CARE: "Vision Care",
    MEDICAL_PRIMARY_CARE: "Doctor Visits",
    MEDICAL_PHARMACIES_AND_SUPPLEMENTS: "Healthcare",

    INCOME_WAGES: "Salary",
    INCOME_DIVIDENDS: "Dividends & Interest",
    INCOME_INTEREST_EARNED: "Dividends & Interest",
    INCOME_RETIREMENT_PENSION: "Investments",
};

// Used when the detailed category has no match
export const PLAID_PRIMARY_CATEGORY_MAP: Record<string, string> = {
    FOOD_AND_DRINK: "Restaurants",
    GENERAL_MERCHANDISE: "General",
    RENT_AND_UTILITIES: "Utilities",
    HOME_IMPROVEMENT: "Maintenance",
    MEDICAL: "Healthcare",
    PERSONAL_CARE: "Wellness",
};

export type ConvertedPlaidTransaction = {
    plaidTransactionId: string;
    amount: number;
    type: TransactionType;
    date: Date;
    description: string;
    // Universal category to file it under, null when there is no match
    categoryName: string | null;
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

    const categoryName = pfc
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
        categoryName,
    };
}
