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
        const { public_token } = await request.json()

        const response = await client.itemPublicTokenExchange({
            public_token,
        })

        return NextResponse.json({
            access_token: response.data.access_token,
            item_id: response.data.item_id,
        })
    } catch (error) {
        console.error("Error exchanging token:", error)
        return NextResponse.json({ error: "Failed to exchange token" }, { status: 500 })
    }
}
