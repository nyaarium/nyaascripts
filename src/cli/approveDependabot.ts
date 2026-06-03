import path from "node:path";
import readline from "node:readline";
import dotenv from "dotenv";
import { githubApproveDependabot } from "../tools/github/tools/githubApproveDependabot.ts";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);

process.env.DOTENV_CONFIG_QUIET = "true";
dotenv.config({ path: path.resolve(scriptDir, "../../.env") });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question: string): Promise<string> {
	return new Promise((resolve) => rl.question(question, resolve));
}

const approveOwnAnswer = await ask("❓ Approve our own common libs? Y/N: ");
const approveOwnLibs = approveOwnAnswer.toLowerCase() === "y";

const approveDistAnswer = await ask("❓ Approve dist/ update? Y/N: ");
const approveDistUpdates = approveDistAnswer.toLowerCase() === "y";

rl.close();

const dryRun = process.argv.includes("--dry-run");
const cwd = process.cwd();

const result = await githubApproveDependabot.handler(cwd, { dryRun, approveOwnLibs, approveDistUpdates });
console.log(JSON.stringify(result, null, 2));
