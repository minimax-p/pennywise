import { type NextRequest, NextResponse } from "next/server"
import { PlaidApi, Configuration, PlaidEnvironments } from "plaid"

const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
        headers: {
            "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
            "PLAID-SECRET": process.env.PLAID_SECRET,
        },
    },
})

const client = new PlaidApi(configuration)

export async function POST(request: NextRequest) {
    try {
        const { access_token } = await request.json()

        // Get transactions from the last 30 days
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - 30)
        const endDate = new Date()

        const response = await client.transactionsGet({
            access_token,
            start_date: startDate.toISOString().split("T")[0],
            end_date: endDate.toISOString().split("T")[0],
        })

        const transactions = response.data.transactions
            .filter((transaction) => transaction.amount > 0) // Only spending (positive amounts)
            .map((transaction) => ({
                transaction_id: transaction.transaction_id,
                account_id: transaction.account_id,
                amount: transaction.amount,
                date: transaction.date,
                name: transaction.name,
                category: transaction.category || ["Other"],
            }))

        // Calculate spending by category
        const categorySpending: Record<string, number> = {}
        let totalSpending = 0

        transactions.forEach((transaction) => {
            const category = transaction.category[0] || "Other"
            categorySpending[category] = (categorySpending[category] || 0) + transaction.amount
            totalSpending += transaction.amount
        })

        return NextResponse.json({
            success: true,
            data: {
                transactions: transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
                totalSpending,
                categorySpending,
            },
        })
    } catch (error) {
        console.error("Error fetching transactions:", error)
        return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 })
    }
}
