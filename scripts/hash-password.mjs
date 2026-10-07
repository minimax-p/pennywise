// Prints a PENNYWISE_PASSWORD_HASH value for the password you type.
// Usage: node scripts/hash-password.mjs   (or pipe the password on stdin)
import {randomBytes, scrypt} from "node:crypto";
import {createInterface} from "node:readline";

const MIN_LENGTH = 12;

// Asks on the terminal without showing what is typed. The prompt goes to stderr, so only
// the hash is printed and it can be captured.
function ask(prompt) {
    return new Promise((resolve) => {
        const rl = createInterface({input: process.stdin, output: process.stderr, terminal: true});
        rl._writeToOutput = (text) => {
            if (text.includes(prompt)) rl.output.write(text);
        };
        rl.question(prompt, (answer) => {
            rl.close();
            process.stderr.write("\n");
            resolve(answer);
        });
    });
}

async function readPassword() {
    if (!process.stdin.isTTY) {
        return new Promise((resolve) => {
            let data = "";
            process.stdin.on("data", (chunk) => data += chunk);
            process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
        });
    }
    const password = await ask("Password: ");
    if (await ask("Same password again: ") !== password) {
        console.error("The two passwords don't match.");
        process.exit(1);
    }
    return password;
}

const password = await readPassword();
if (password.length < MIN_LENGTH) {
    console.error(`Use at least ${MIN_LENGTH} characters. This password protects your financial data on a public URL.`);
    process.exit(1);
}

const [N, r, p] = [16384, 8, 1];
const salt = randomBytes(16);
scrypt(password, salt, 64, {N, r, p, maxmem: 128 * N * r * 2}, (error, hash) => {
    if (error) throw error;
    console.log(["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join(":"));
});
