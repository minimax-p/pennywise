// The built-in categories. Shared by prisma/seed.mjs and the app (lib/categoryKeys.ts).
// Each has a stable key, so you can rename it, change its emoji or move it to another
// group, and keyword rules still find it. The seed only adds categories that are missing;
// it never changes ones you edited.

export const CATEGORIES = [
    // Money coming in
    {key: "paycheck", name: "Paycheck", icon: "💼", type: "income", group: "Income"},
    {key: "sold-stuff", name: "Sold stuff", icon: "🏷️", type: "income", group: "Income"},
    {key: "interest", name: "Interest", icon: "🏦", type: "income", group: "Income"},
    {key: "other-income", name: "Other income", icon: "➕", type: "income", group: "Income"},

    {key: "rent", name: "Rent", icon: "🏠", type: "expense", group: "Home"},
    {key: "utilities", name: "Utilities", icon: "💡", type: "expense", group: "Home"},
    {key: "phone-internet", name: "Phone & internet", icon: "📶", type: "expense", group: "Home"},
    {key: "household", name: "Household", icon: "🧺", type: "expense", group: "Home"},

    {key: "groceries", name: "Groceries", icon: "🛒", type: "expense", group: "Food"},
    {key: "eating-out", name: "Eating out", icon: "🍜", type: "expense", group: "Food"},
    {key: "coffee-snacks", name: "Coffee & snacks", icon: "☕", type: "expense", group: "Food"},

    {key: "gas", name: "Gas", icon: "⛽", type: "expense", group: "Getting around"},
    {key: "car", name: "Car", icon: "🚗", type: "expense", group: "Getting around"},
    {key: "rides", name: "Rides & transit", icon: "🚇", type: "expense", group: "Getting around"},

    {key: "shopping", name: "Shopping", icon: "🛍️", type: "expense", group: "Life"},
    {key: "health", name: "Health", icon: "💊", type: "expense", group: "Life"},
    {key: "personal-care", name: "Personal care", icon: "💇", type: "expense", group: "Life"},
    {key: "subscriptions", name: "Subscriptions", icon: "📺", type: "expense", group: "Life"},
    {key: "fun", name: "Fun", icon: "🎟️", type: "expense", group: "Life"},
    {key: "travel", name: "Travel", icon: "✈️", type: "expense", group: "Life"},
    {key: "gifts", name: "Gifts & giving", icon: "🎁", type: "expense", group: "Life"},
    {key: "education", name: "Education", icon: "🎓", type: "expense", group: "Life"},

    {key: "fees", name: "Fees & interest", icon: "🧾", type: "expense", group: "Money"},
    {key: "taxes", name: "Taxes & government", icon: "🏛️", type: "expense", group: "Money"},
    // Cash that left your wallet without being logged, found by counting it
    {key: "untracked-cash", name: "Untracked cash", icon: "💵", type: "expense", group: "Money"},

    // Built in: not spending or income, or not decided yet
    {key: "transfer", name: "Transfer", icon: "🔁", type: "transfer", group: null},
    {key: "split", name: "Split", icon: "✂️", type: "split", group: null},
    {key: "adjustment", name: "Adjustment", icon: "⚖️", type: "adjustment", group: null},
    {key: "unsorted-expense", name: "Unsorted", icon: "❓", type: "expense", group: null},
    {key: "unsorted-income", name: "Unsorted", icon: "❓", type: "income", group: null},
].map((category, sortOrder) => ({...category, sortOrder}));

// Categories that can't be renamed, hidden or merged: the app relies on them
export const SYSTEM_KEYS = ["transfer", "split", "adjustment", "unsorted-expense", "unsorted-income"];

// The categories Pennywise started with, and where their transactions went
export const LEGACY = {
    expense: {
        "Restaurants": "eating-out", "Fast Food": "eating-out", "Bars & Pubs": "eating-out", "Takeout": "eating-out",
        "Meal Kits": "groceries", "Food Delivery": "eating-out", "Groceries": "groceries",
        "Coffee Shops": "coffee-snacks", "Snacks & Treats": "coffee-snacks", "Bubble Tea": "coffee-snacks", "Desserts": "coffee-snacks",
        "Gas": "gas", "Public Transit": "rides", "Taxi/Uber": "rides", "Bike Rentals": "rides", "E-Scooters": "rides",
        "Ride Shares": "rides", "Parking Fees": "car", "Car Rentals": "travel", "Car Payments": "car",
        "Vehicle Maintenance": "car", "Toll Fees": "car",
        "Rent/Mortgage": "rent", "Utilities": "utilities", "Maintenance": "household", "Internet": "phone-internet",
        "Streaming Services": "subscriptions", "Home Furnishings": "household", "Cleaning Services": "household",
        "Renters Insurance": "rent", "Home Security": "household", "Smart Home Devices": "shopping", "Home Decor": "household",
        "Movies": "fun", "Music": "subscriptions", "Games": "fun", "Subscriptions": "subscriptions",
        "Events & Concerts": "fun", "Books & eBooks": "fun", "Outdoor Activities": "fun", "Board Games & Puzzles": "fun",
        "Karaoke": "fun", "Social Clubs Memberships": "fun", "Digital Media": "subscriptions",
        "Clothing": "shopping", "General": "shopping", "Books": "shopping", "Electronics": "shopping",
        "Smartphones & Accessories": "shopping", "Pets": "household", "Amazon": "shopping", "Beauty & Grooming": "personal-care",
        "Online Subscriptions": "subscriptions", "Footwear": "shopping", "Bags & Accessories": "shopping",
        "Watches & Jewelry": "shopping", "Tech Gadgets": "shopping", "Home Appliances": "household",
        "Healthcare": "health", "Gym": "health", "Wellness": "health", "Nutrition & Supplements": "health",
        "Skincare": "personal-care", "Dental Care": "health", "Sports & Fitness Gear": "shopping", "Vision Care": "health",
        "Lab Tests & Screenings": "health", "Vaccinations": "health", "Doctor Visits": "health",
        "Fees & interest": "fees", "Untracked cash": "untracked-cash", "Unsorted": "unsorted-expense",
    },
    income: {
        "Salary": "paycheck", "Freelance": "other-income", "Investments": "interest", "Side Hustles": "other-income",
        "eCommerce Earnings": "sold-stuff", "Dividends & Interest": "interest", "Gig Economy": "other-income",
        "Content Creation": "other-income", "Reselling": "sold-stuff", "Ride-Share Driving": "other-income",
        "Streaming Income": "other-income", "Unsorted": "unsorted-income",
    },
    transfer: {"Transfer": "transfer"},
    split: {"Split": "split"},
    adjustment: {"Adjustment": "adjustment"},
};
