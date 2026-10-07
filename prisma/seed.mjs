// Seeds the universal categories shared by every user.
// Run with `npx prisma db seed`. Safe to run more than once: existing categories are left alone.
import {PrismaClient} from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
    // Food & Dining
    {name: "Restaurants", icon: "🍽️", type: "expense", tag: "Food & Dining"},
    {name: "Groceries", icon: "🛒", type: "expense", tag: "Food & Dining"},
    {name: "Coffee Shops", icon: "☕", type: "expense", tag: "Food & Dining"},
    {name: "Fast Food", icon: "🍕", type: "expense", tag: "Food & Dining"},
    {name: "Bars & Pubs", icon: "🍻", type: "expense", tag: "Food & Dining"},
    {name: "Takeout", icon: "🍱", type: "expense", tag: "Food & Dining"},
    {name: "Meal Kits", icon: "🍲", type: "expense", tag: "Food & Dining"},
    {name: "Food Delivery", icon: "🥡", type: "expense", tag: "Food & Dining"},
    {name: "Snacks & Treats", icon: "🍦", type: "expense", tag: "Food & Dining"},
    {name: "Bubble Tea", icon: "🥤", type: "expense", tag: "Food & Dining"},
    {name: "Desserts", icon: "🍰", type: "expense", tag: "Food & Dining"},

    // Transportation
    {name: "Gas", icon: "🚗", type: "expense", tag: "Transportation"},
    {name: "Public Transit", icon: "🚇", type: "expense", tag: "Transportation"},
    {name: "Taxi/Uber", icon: "🚕", type: "expense", tag: "Transportation"},
    {name: "Bike Rentals", icon: "🚲", type: "expense", tag: "Transportation"},
    {name: "E-Scooters", icon: "🛴", type: "expense", tag: "Transportation"},
    {name: "Parking Fees", icon: "🅿️", type: "expense", tag: "Transportation"},
    {name: "Car Rentals", icon: "🚗", type: "expense", tag: "Transportation"},
    {name: "Car Payments", icon: "🚘", type: "expense", tag: "Transportation"},
    {name: "Vehicle Maintenance", icon: "🔧", type: "expense", tag: "Transportation"},
    {name: "Toll Fees", icon: "🛣️", type: "expense", tag: "Transportation"},
    {name: "Ride Shares", icon: "🏎️", type: "expense", tag: "Transportation"},

    // Housing
    {name: "Rent/Mortgage", icon: "🏠", type: "expense", tag: "Housing"},
    {name: "Utilities", icon: "🔧", type: "expense", tag: "Housing"},
    {name: "Maintenance", icon: "🛠️", type: "expense", tag: "Housing"},
    {name: "Internet", icon: "🔌", type: "expense", tag: "Housing"},
    {name: "Streaming Services", icon: "📺", type: "expense", tag: "Housing"},
    {name: "Home Furnishings", icon: "🛏️", type: "expense", tag: "Housing"},
    {name: "Cleaning Services", icon: "🧹", type: "expense", tag: "Housing"},
    {name: "Renters Insurance", icon: "🔑", type: "expense", tag: "Housing"},
    {name: "Home Security", icon: "🚪", type: "expense", tag: "Housing"},
    {name: "Smart Home Devices", icon: "💡", type: "expense", tag: "Housing"},
    {name: "Home Decor", icon: "🛍️", type: "expense", tag: "Housing"},

    // Entertainment
    {name: "Movies", icon: "🎬", type: "expense", tag: "Entertainment"},
    {name: "Music", icon: "🎵", type: "expense", tag: "Entertainment"},
    {name: "Games", icon: "🎮", type: "expense", tag: "Entertainment"},
    {name: "Subscriptions", icon: "🎧", type: "expense", tag: "Entertainment"},
    {name: "Events & Concerts", icon: "🎢", type: "expense", tag: "Entertainment"},
    {name: "Books & eBooks", icon: "📚", type: "expense", tag: "Entertainment"},
    {name: "Outdoor Activities", icon: "🏞️", type: "expense", tag: "Entertainment"},
    {name: "Board Games & Puzzles", icon: "🃏", type: "expense", tag: "Entertainment"},
    {name: "Karaoke", icon: "🎤", type: "expense", tag: "Entertainment"},
    {name: "Social Clubs Memberships", icon: "🎯", type: "expense", tag: "Entertainment"},
    {name: "Digital Media", icon: "📽️", type: "expense", tag: "Entertainment"},

    // Shopping
    {name: "Clothing", icon: "👚", type: "expense", tag: "Shopping"},
    {name: "General", icon: "🛍️", type: "expense", tag: "Shopping"},
    {name: "Books", icon: "📚", type: "expense", tag: "Shopping"},
    {name: "Electronics", icon: "💻", type: "expense", tag: "Shopping"},
    {name: "Smartphones & Accessories", icon: "📱", type: "expense", tag: "Shopping"},
    {name: "Pets", icon: "🐾", type: "expense", tag: "Shopping"},
    {name: "Amazon", icon: "🖥️", type: "expense", tag: "Shopping"},
    {name: "Beauty & Grooming", icon: "💄", type: "expense", tag: "Shopping"},
    {name: "Online Subscriptions", icon: "📦", type: "expense", tag: "Shopping"},
    {name: "Footwear", icon: "👠", type: "expense", tag: "Shopping"},
    {name: "Bags & Accessories", icon: "🎒", type: "expense", tag: "Shopping"},
    {name: "Watches & Jewelry", icon: "⌚", type: "expense", tag: "Shopping"},
    {name: "Tech Gadgets", icon: "💡", type: "expense", tag: "Shopping"},
    {name: "Home Appliances", icon: "🔌", type: "expense", tag: "Shopping"},

    // Health & Fitness
    {name: "Healthcare", icon: "💊", type: "expense", tag: "Health & Fitness"},
    {name: "Gym", icon: "🏋️", type: "expense", tag: "Health & Fitness"},
    {name: "Wellness", icon: "🧘", type: "expense", tag: "Health & Fitness"},
    {name: "Nutrition & Supplements", icon: "🥗", type: "expense", tag: "Health & Fitness"},
    {name: "Skincare", icon: "🧴", type: "expense", tag: "Health & Fitness"},
    {name: "Dental Care", icon: "🦷", type: "expense", tag: "Health & Fitness"},
    {name: "Sports & Fitness Gear", icon: "🏃‍♂️", type: "expense", tag: "Health & Fitness"},
    {name: "Vision Care", icon: "👓", type: "expense", tag: "Health & Fitness"},
    {name: "Lab Tests & Screenings", icon: "🧪", type: "expense", tag: "Health & Fitness"},
    {name: "Vaccinations", icon: "💉", type: "expense", tag: "Health & Fitness"},
    {name: "Doctor Visits", icon: "🩺", type: "expense", tag: "Health & Fitness"},

    // Income
    {name: "Salary", icon: "💼", type: "income", tag: "Income"},
    {name: "Freelance", icon: "💰", type: "income", tag: "Income"},
    {name: "Investments", icon: "📈", type: "income", tag: "Income"},
    {name: "Side Hustles", icon: "💸", type: "income", tag: "Income"},
    {name: "eCommerce Earnings", icon: "🛒", type: "income", tag: "Income"},
    {name: "Dividends & Interest", icon: "🏦", type: "income", tag: "Income"},
    {name: "Gig Economy", icon: "🎯", type: "income", tag: "Income"},
    {name: "Content Creation", icon: "📝", type: "income", tag: "Income"},
    {name: "Reselling", icon: "📦", type: "income", tag: "Income"},
    {name: "Ride-Share Driving", icon: "🚗", type: "income", tag: "Income"},
    {name: "Streaming Income", icon: "🎮", type: "income", tag: "Income"},

    // Money moved between your own accounts. Not counted as income or spending.
    {name: "Transfer", icon: "🔁", type: "transfer", tag: null},

    // Fallback for transactions whose category was deleted or could not be matched
    {name: "Unsorted", icon: "❓", type: "expense", tag: null},
    {name: "Unsorted", icon: "❓", type: "income", tag: null},
];

async function main() {
    let created = 0;
    for (const category of categories) {
        const existing = await prisma.category.findFirst({
            where: {name: category.name, type: category.type, isUniversal: true},
        });
        if (existing) continue;
        await prisma.category.create({data: {...category, isUniversal: true}});
        created++;
    }
    console.log(`Seeded ${created} universal categories (${categories.length - created} already existed)`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
