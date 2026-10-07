import {createServer, IncomingMessage, Server} from "node:http";
import {AddressInfo} from "node:net";

// A stand-in for api.typesafe.ai so tests exercise the real SDK over HTTP.
// `decide` picks the answer for each choice question from the request.

export type RecordedRequest = { path: string, authorization: string | undefined, body: any };
export type Decide = (body: any, labels: string[]) => { choice: string, confidence: number } | { status: number };

export async function startFakeJev(decide: Decide) {
    const requests: RecordedRequest[] = [];
    const server: Server = createServer(async (req: IncomingMessage, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : null;
        requests.push({path: req.url ?? "", authorization: req.headers.authorization, body});

        const answers: Record<string, unknown> = {};
        for (const [name, question] of Object.entries<any>(body.questions)) {
            const labels = Object.keys(question.criteria);
            const decision = decide(body, labels);
            if ("status" in decision) {
                res.writeHead(decision.status, {"content-type": "application/json"});
                res.end(JSON.stringify({error: {message: "rejected"}}));
                return;
            }
            const rest = labels.filter((l) => l !== decision.choice);
            const share = rest.length ? (1 - decision.confidence) / rest.length : 0;
            answers[name] = {
                type: "choice",
                choice: decision.choice,
                confidence: decision.confidence,
                probabilities: Object.fromEntries(labels.map((l) => [l, l === decision.choice ? decision.confidence : share])),
            };
        }
        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify({model: body.model, answers, usage: {input_tokens: 100, output_tokens: 0}}));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address() as AddressInfo;

    const previous = {key: process.env.TYPESAFE_API_KEY, url: process.env.TYPESAFE_BASE_URL};
    process.env.TYPESAFE_API_KEY = "test-key";
    process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${port}`;

    return {
        requests,
        async stop() {
            process.env.TYPESAFE_API_KEY = previous.key;
            process.env.TYPESAFE_BASE_URL = previous.url;
            if (previous.key === undefined) delete process.env.TYPESAFE_API_KEY;
            if (previous.url === undefined) delete process.env.TYPESAFE_BASE_URL;
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

// Answers like a sensible model would for the merchants used in tests
export function byMerchant(rules: Record<string, [string, number]>): Decide {
    return (body, labels) => {
        const description: string = body.state.transaction.description.toUpperCase();
        const match = Object.entries(rules).find(([word]) => description.includes(word));
        const [choice, confidence] = match ? match[1] : [labels[0], 0.2];
        return {choice: labels.includes(choice) ? choice : labels[0], confidence};
    };
}
