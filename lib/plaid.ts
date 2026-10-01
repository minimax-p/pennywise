import {Configuration, CountryCode, PlaidApi, PlaidEnvironments, PlaidError} from 'plaid';

const plaidEnv = process.env.PLAID_ENV || 'sandbox';

if (!PlaidEnvironments[plaidEnv]) {
    throw new Error(`Invalid PLAID_ENV "${plaidEnv}". Use one of: ${Object.keys(PlaidEnvironments).join(', ')}`);
}

const configuration = new Configuration({
    basePath: PlaidEnvironments[plaidEnv],
    baseOptions: {
        headers: {
            'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
            'PLAID-SECRET': process.env.PLAID_SECRET,
            'Plaid-Version': '2020-09-14',
        },
    },
});

export const plaidClient = new PlaidApi(configuration);

// Comma separated list of country codes, e.g. "US,CA". Defaults to US.
export const plaidCountryCodes: CountryCode[] = (process.env.PLAID_COUNTRY_CODES || 'US')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean) as CountryCode[];

// Plaid API errors are axios errors whose response body is a PlaidError
export function getPlaidError(error: unknown): PlaidError | null {
    const data = (error as { response?: { data?: Partial<PlaidError> } } | null)?.response?.data;
    if (data && typeof data.error_code === 'string') {
        return data as PlaidError;
    }
    return null;
}
