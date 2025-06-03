import { type NextRequest, NextResponse } from "next/server"
import { PlaidApi, Configuration, PlaidEnvironments, type LinkTokenCreateRequest, CountryCode, Products } from "plaid"

const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox, // Use sandbox for development
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
        const linkTokenRequest: LinkTokenCreateRequest = {
            user: {
                client_user_id: "unique_user_id", // In production, use actual user ID
            },
            client_name: "Spending Tracker",
            products: [Products.Transactions],
            country_codes: [CountryCode.Us],
            language: "en",
        }

        const response = await client.linkTokenCreate(linkTokenRequest)

        return NextResponse.json({
            link_token: response.data.link_token,
        })
    } catch (error) {
        console.error("Error creating link token:", error)
        return NextResponse.json({ error: "Failed to create link token" }, { status: 500 })
    }
}
