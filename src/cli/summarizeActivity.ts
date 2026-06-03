import path from "node:path";
import dotenv from "dotenv";
import { gitSummarizeActivity } from "../tools/git/tools/gitSummarizeActivity.ts";

// Load .env from project root
const scriptDir = path.dirname(new URL(import.meta.url).pathname);

process.env.DOTENV_CONFIG_QUIET = "true";
dotenv.config({ path: path.resolve(scriptDir, "../../.env") });

const days = Number.parseInt(process.argv[2] ?? "7", 10);
const author = process.argv[3];
const cwd = process.cwd();

if (Number.isNaN(days) || days < 1 || days > 365) {
	console.error("Usage: summarize-activity <days> [author]");
	console.error("  days: 1-365");
	process.exit(1);
}

const result = await gitSummarizeActivity.handler(cwd, { days, author });
if (result?.data?.summary) {
	console.log(result.data.summary);
} else {
	console.log(JSON.stringify(result, null, 2));
}
