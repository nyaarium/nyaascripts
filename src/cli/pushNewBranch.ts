import path from "node:path";
import readline from "node:readline";
import dotenv from "dotenv";
import { detectMainBranch, gitPushNewBranch, slugifyBranchName } from "../tools/git/tools/gitPushNewBranch.ts";
import { checkGHCLI } from "../tools/github/lib/checkGHCLI.ts";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);

process.env.DOTENV_CONFIG_QUIET = "true";
dotenv.config({ path: path.resolve(scriptDir, "../../.env") });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question: string): Promise<string> {
	return new Promise((resolve) => rl.question(question, resolve));
}

function askYN(question: string): Promise<boolean> {
	return new Promise((resolve) => {
		const prompt = () => {
			rl.question(question, (answer) => {
				const lower = answer.toLowerCase();
				if (lower === "y") resolve(true);
				else if (lower === "n") resolve(false);
				else {
					console.log("Expected a Y/N answer.");
					prompt();
				}
			});
		};
		prompt();
	});
}

const cwd = process.cwd();
const dryRun = process.argv.includes("--dry-run");

// Check gh CLI availability
const ghStatus = await checkGHCLI(cwd);
if (!ghStatus.available) {
	console.log("⚠️  GitHub CLI is not installed. Skipping pull request.");
} else if (!ghStatus.authenticated) {
	console.log("⚠️  GitHub CLI is not authenticated. Skipping pull request.");
}
const ghReady = ghStatus.available && ghStatus.authenticated;

// Detect main branch and current branch
const { spawn } = await import("node:child_process");
function gitSync(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], cwd });
		let out = "";
		child.stdout.on("data", (d: Buffer) => {
			out += d.toString();
		});
		child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args[0]} failed`))));
		child.on("error", (e) => reject(e));
	});
}

const mainBranch = await detectMainBranch(cwd);
const currentBranch = await gitSync(["branch", "--show-current"]);

let prTitle = "";
let branchName = "";
let createPr = false;
let autoMerge = false;

if (ghReady) {
	console.log("");
	prTitle = await ask("✏️  Pull request title: ");

	// Default branch name
	if (currentBranch === mainBranch) {
		branchName = prTitle ? slugifyBranchName(prTitle) : "";
	} else {
		branchName = currentBranch;
	}

	console.log("");
	const enteredBranch = await ask(`✏️  Optional branch name (press enter for default):  ${branchName}\n`);
	if (enteredBranch.trim()) {
		branchName = slugifyBranchName(enteredBranch.trim());
	}
} else {
	console.log("");
	const enteredBranch = await ask("✏️  Branch name: ");
	if (enteredBranch.trim()) {
		branchName = slugifyBranchName(enteredBranch.trim());
	} else if (currentBranch !== mainBranch) {
		branchName = currentBranch;
	}
}

if (!branchName) {
	console.log("Branch name is required.");
	rl.close();
	process.exit(1);
}

if (branchName === "main" || branchName === "master") {
	console.log("Branch name cannot be 'main' or 'master'.");
	rl.close();
	process.exit(1);
}

if (ghReady) {
	console.log("");
	createPr = await askYN("❓ Create pull request? Y/N: ");

	if (createPr && prTitle) {
		console.log("");
		autoMerge = await askYN("❓ Auto-merge pull request? Y/N: ");
	}
}

rl.close();

const result = await gitPushNewBranch.handler(cwd, {
	branchName,
	prTitle: prTitle || undefined,
	createPr,
	autoMerge,
	dryRun,
});

console.log("");
if (result.data.dryRun) {
	console.log("Dry run — actions that would be taken:");
	for (const action of (result.data as { actions: string[] }).actions) {
		console.log(`  - ${action}`);
	}
} else {
	console.log("Branch pushed to origin.");
	if (result.data.prUrl) {
		console.log(`✅ Pull request created: ${result.data.prUrl}`);
	}
	if (result.data.autoMerge) {
		console.log("Auto-merge enabled.");
	}
}
