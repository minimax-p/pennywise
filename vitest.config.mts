import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";

export default defineConfig({
    resolve: {
        alias: {"@": fileURLToPath(new URL(".", import.meta.url))},
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // Database tests share one database, and parallel cleanups can deadlock
        fileParallelism: !process.env.TEST_DATABASE_URL,
    },
});
