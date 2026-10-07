-- The new category set. Built-in categories get a stable key, a group and an order; the
-- old built-in categories are folded into the new ones, and their transactions, split parts
-- and rules move with them. Categories you made yourself are kept as they are. Generated from
-- prisma/categories.mjs.

ALTER TABLE "Category" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "key" TEXT,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Category_key_key" ON "Category"("key");

CREATE TEMP TABLE new_categories ("key" TEXT, "name" TEXT, "icon" TEXT, "type" TEXT, "group" TEXT, "sortOrder" INTEGER);
INSERT INTO new_categories VALUES
    ('paycheck', 'Paycheck', '💼', 'income', 'Income', 0),
    ('sold-stuff', 'Sold stuff', '🏷️', 'income', 'Income', 1),
    ('interest', 'Interest', '🏦', 'income', 'Income', 2),
    ('other-income', 'Other income', '➕', 'income', 'Income', 3),
    ('rent', 'Rent', '🏠', 'expense', 'Home', 4),
    ('utilities', 'Utilities', '💡', 'expense', 'Home', 5),
    ('phone-internet', 'Phone & internet', '📶', 'expense', 'Home', 6),
    ('household', 'Household', '🧺', 'expense', 'Home', 7),
    ('groceries', 'Groceries', '🛒', 'expense', 'Food', 8),
    ('eating-out', 'Eating out', '🍜', 'expense', 'Food', 9),
    ('coffee-snacks', 'Coffee & snacks', '☕', 'expense', 'Food', 10),
    ('gas', 'Gas', '⛽', 'expense', 'Getting around', 11),
    ('car', 'Car', '🚗', 'expense', 'Getting around', 12),
    ('rides', 'Rides & transit', '🚇', 'expense', 'Getting around', 13),
    ('shopping', 'Shopping', '🛍️', 'expense', 'Life', 14),
    ('health', 'Health', '💊', 'expense', 'Life', 15),
    ('personal-care', 'Personal care', '💇', 'expense', 'Life', 16),
    ('subscriptions', 'Subscriptions', '📺', 'expense', 'Life', 17),
    ('fun', 'Fun', '🎟️', 'expense', 'Life', 18),
    ('travel', 'Travel', '✈️', 'expense', 'Life', 19),
    ('gifts', 'Gifts & giving', '🎁', 'expense', 'Life', 20),
    ('education', 'Education', '🎓', 'expense', 'Life', 21),
    ('fees', 'Fees & interest', '🧾', 'expense', 'Money', 22),
    ('taxes', 'Taxes & government', '🏛️', 'expense', 'Money', 23),
    ('untracked-cash', 'Untracked cash', '💵', 'expense', 'Money', 24),
    ('transfer', 'Transfer', '🔁', 'transfer', NULL, 25),
    ('split', 'Split', '✂️', 'split', NULL, 26),
    ('adjustment', 'Adjustment', '⚖️', 'adjustment', NULL, 27),
    ('unsorted-expense', 'Unsorted', '❓', 'expense', NULL, 28),
    ('unsorted-income', 'Unsorted', '❓', 'income', NULL, 29);

CREATE TEMP TABLE legacy_categories ("name" TEXT, "type" TEXT, "key" TEXT);
INSERT INTO legacy_categories VALUES
    ('Restaurants', 'expense', 'eating-out'),
    ('Fast Food', 'expense', 'eating-out'),
    ('Bars & Pubs', 'expense', 'eating-out'),
    ('Takeout', 'expense', 'eating-out'),
    ('Meal Kits', 'expense', 'groceries'),
    ('Food Delivery', 'expense', 'eating-out'),
    ('Groceries', 'expense', 'groceries'),
    ('Coffee Shops', 'expense', 'coffee-snacks'),
    ('Snacks & Treats', 'expense', 'coffee-snacks'),
    ('Bubble Tea', 'expense', 'coffee-snacks'),
    ('Desserts', 'expense', 'coffee-snacks'),
    ('Gas', 'expense', 'gas'),
    ('Public Transit', 'expense', 'rides'),
    ('Taxi/Uber', 'expense', 'rides'),
    ('Bike Rentals', 'expense', 'rides'),
    ('E-Scooters', 'expense', 'rides'),
    ('Ride Shares', 'expense', 'rides'),
    ('Parking Fees', 'expense', 'car'),
    ('Car Rentals', 'expense', 'travel'),
    ('Car Payments', 'expense', 'car'),
    ('Vehicle Maintenance', 'expense', 'car'),
    ('Toll Fees', 'expense', 'car'),
    ('Rent/Mortgage', 'expense', 'rent'),
    ('Utilities', 'expense', 'utilities'),
    ('Maintenance', 'expense', 'household'),
    ('Internet', 'expense', 'phone-internet'),
    ('Streaming Services', 'expense', 'subscriptions'),
    ('Home Furnishings', 'expense', 'household'),
    ('Cleaning Services', 'expense', 'household'),
    ('Renters Insurance', 'expense', 'rent'),
    ('Home Security', 'expense', 'household'),
    ('Smart Home Devices', 'expense', 'shopping'),
    ('Home Decor', 'expense', 'household'),
    ('Movies', 'expense', 'fun'),
    ('Music', 'expense', 'subscriptions'),
    ('Games', 'expense', 'fun'),
    ('Subscriptions', 'expense', 'subscriptions'),
    ('Events & Concerts', 'expense', 'fun'),
    ('Books & eBooks', 'expense', 'fun'),
    ('Outdoor Activities', 'expense', 'fun'),
    ('Board Games & Puzzles', 'expense', 'fun'),
    ('Karaoke', 'expense', 'fun'),
    ('Social Clubs Memberships', 'expense', 'fun'),
    ('Digital Media', 'expense', 'subscriptions'),
    ('Clothing', 'expense', 'shopping'),
    ('General', 'expense', 'shopping'),
    ('Books', 'expense', 'shopping'),
    ('Electronics', 'expense', 'shopping'),
    ('Smartphones & Accessories', 'expense', 'shopping'),
    ('Pets', 'expense', 'household'),
    ('Amazon', 'expense', 'shopping'),
    ('Beauty & Grooming', 'expense', 'personal-care'),
    ('Online Subscriptions', 'expense', 'subscriptions'),
    ('Footwear', 'expense', 'shopping'),
    ('Bags & Accessories', 'expense', 'shopping'),
    ('Watches & Jewelry', 'expense', 'shopping'),
    ('Tech Gadgets', 'expense', 'shopping'),
    ('Home Appliances', 'expense', 'household'),
    ('Healthcare', 'expense', 'health'),
    ('Gym', 'expense', 'health'),
    ('Wellness', 'expense', 'health'),
    ('Nutrition & Supplements', 'expense', 'health'),
    ('Skincare', 'expense', 'personal-care'),
    ('Dental Care', 'expense', 'health'),
    ('Sports & Fitness Gear', 'expense', 'shopping'),
    ('Vision Care', 'expense', 'health'),
    ('Lab Tests & Screenings', 'expense', 'health'),
    ('Vaccinations', 'expense', 'health'),
    ('Doctor Visits', 'expense', 'health'),
    ('Fees & interest', 'expense', 'fees'),
    ('Untracked cash', 'expense', 'untracked-cash'),
    ('Unsorted', 'expense', 'unsorted-expense'),
    ('Salary', 'income', 'paycheck'),
    ('Freelance', 'income', 'other-income'),
    ('Investments', 'income', 'interest'),
    ('Side Hustles', 'income', 'other-income'),
    ('eCommerce Earnings', 'income', 'sold-stuff'),
    ('Dividends & Interest', 'income', 'interest'),
    ('Gig Economy', 'income', 'other-income'),
    ('Content Creation', 'income', 'other-income'),
    ('Reselling', 'income', 'sold-stuff'),
    ('Ride-Share Driving', 'income', 'other-income'),
    ('Streaming Income', 'income', 'other-income'),
    ('Unsorted', 'income', 'unsorted-income'),
    ('Transfer', 'transfer', 'transfer'),
    ('Split', 'split', 'split'),
    ('Adjustment', 'adjustment', 'adjustment');

-- Built-in categories that keep their name become the new ones in place
UPDATE "Category" c SET "key" = n."key", "icon" = n."icon", "tag" = n."group", "sortOrder" = n."sortOrder"
FROM new_categories n
WHERE c."isUniversal" AND c."key" IS NULL AND c."name" = n."name" AND c."type" = n."type"
  AND c."id" = (SELECT MIN(d."id") FROM "Category" d WHERE d."isUniversal" AND d."name" = n."name" AND d."type" = n."type");

INSERT INTO "Category" ("id", "createdAt", "name", "userId", "icon", "type", "isUniversal", "tag", "key", "sortOrder")
SELECT gen_random_uuid()::text, CURRENT_TIMESTAMP, n."name", NULL, n."icon", n."type", true, n."group", n."key", n."sortOrder"
FROM new_categories n
WHERE NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."key" = n."key");

-- Where each old built-in category goes
CREATE TEMP TABLE category_moves AS
SELECT old."id" AS "from", new."id" AS "to"
FROM "Category" old
JOIN legacy_categories l ON l."name" = old."name" AND l."type" = old."type"
JOIN "Category" new ON new."key" = l."key"
WHERE old."isUniversal" AND old."key" IS NULL;

UPDATE "Transaction" t SET "categoryId" = m."to" FROM category_moves m WHERE t."categoryId" = m."from";
UPDATE "TransactionLine" t SET "categoryId" = m."to" FROM category_moves m WHERE t."categoryId" = m."from";
UPDATE "Rule" r SET "categoryId" = m."to" FROM category_moves m WHERE r."categoryId" = m."from";

-- Old built-in categories nothing uses any more go; any left are hidden
DELETE FROM "Category" c
WHERE c."isUniversal" AND c."key" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "TransactionLine" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Rule" r WHERE r."categoryId" = c."id");
UPDATE "Category" SET "hidden" = true WHERE "isUniversal" AND "key" IS NULL;


DROP TABLE new_categories, legacy_categories, category_moves;
