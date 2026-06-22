import { spawn } from "node:child_process";
import { z } from "zod";
import { enableAutoMerge, getRepoSettings, manualMerge } from "../../github/lib/approvePr.ts";
import { checkGHCLI } from "../../github/lib/checkGHCLI.ts";
import { runGh } from "../../github/lib/runGh.ts";
import { repoPathParam } from "../lib/repoSchema.ts";
import { resolveRepoCwd } from "../lib/resolveRepoCwd.ts";

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PAGER: "cat" },
			cwd,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 }));
		child.on("error", (e) => resolve({ stdout: "", stderr: e.message, code: 1 }));
	});
}

export function slugifyBranchName(input: string): string {
	return input
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}

export async function detectMainBranch(cwd: string): Promise<string> {
	const result = await runGit(cwd, ["branch", "-r", "--format=%(refname:short)"]);
	if (result.code !== 0) throw new Error(`git branch -r failed: ${result.stderr}`);
	const remotes = result.stdout.split("\n").map((l) => l.trim());
	if (remotes.includes("origin/main")) return "main";
	if (remotes.includes("origin/master")) return "master";
	throw new Error("Could not find 'main' or 'master' branch.");
}

// Parses OWNER/REPO from a git remote URL (SSH or HTTPS)
export function parseOwnerRepoFromRemote(remoteUrl: string): string {
	// SSH: git@github.com:owner/repo.git
	const sshMatch = remoteUrl.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
	if (sshMatch) return sshMatch[1];

	// HTTPS: https://github.com/owner/repo.git
	const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
	if (httpsMatch) return httpsMatch[1];

	throw new Error(`Could not parse OWNER/REPO from remote URL: ${remoteUrl}`);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPrNumber(
	cwd: string,
	branchName: string,
	repoArgs: string[],
	maxAttempts = 3,
): Promise<string | undefined> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const raw = await runGh(cwd, ["pr", "view", branchName, "--json", "number", ...repoArgs]);
			const data = JSON.parse(raw) as { number: number };
			return String(data.number);
		} catch {
			if (attempt < maxAttempts) await sleep(2000);
		}
	}
	return undefined;
}

async function deriveGitHubRepo(cwd: string): Promise<string> {
	const result = await runGit(cwd, ["remote", "get-url", "origin"]);
	if (result.code !== 0) throw new Error(`git remote get-url origin failed: ${result.stderr}`);
	return parseOwnerRepoFromRemote(result.stdout);
}

const schema = z.object({
	branchName: z.string().describe(
		`
Target branch name to push to.
`.trim(),
	),
	prTitle: z
		.string()
		.optional()
		.describe(
			`
Pull request title.

Required if createPr is true.
`.trim(),
		),
	createPr: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
Whether to create a pull request after pushing.
`.trim(),
		),
	autoMerge: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
Whether to enable auto-merge on the created PR.
`.trim(),
		),
	repoPath: repoPathParam,
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would happen without executing.
`.trim(),
		),
});

export const gitPushNewBranch = {
	name: "gitPushNewBranch",
	title: "git-push-new-branch",
	description: `
Move commits from main to a new branch and optionally create a PR.

When on main, this pushes commits to the new branch and resets local main back to origin/main (commits are moved, not copied). When on a feature branch, pushes to the new branch name. After using this tool, always check gitStatus and gitPull to confirm local state is clean, and verify the PR and any CI runners before resuming other work.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { branchName, prTitle, createPr = false, autoMerge = false, dryRun = false } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		const ghStatus = await checkGHCLI(effectiveCwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		if (branchName === "main" || branchName === "master") {
			throw new Error("Branch name cannot be 'main' or 'master'.");
		}

		if (createPr && !prTitle) {
			throw new Error("prTitle is required when createPr is true.");
		}

		const mainBranch = await detectMainBranch(effectiveCwd);

		// Derive OWNER/REPO from git remote for GitHub API calls
		const ghRepo = await deriveGitHubRepo(effectiveCwd);
		const repoArgs = ["--repo", ghRepo];

		// Check for uncommitted TRACKED changes. Untracked files are ignored: a push never
		// touches the working tree, and the `reset --hard` on the main path leaves untracked
		// files in place, so stray untracked files (scratch notes, local docs) must not block.
		const statusResult = await runGit(effectiveCwd, ["status", "-s"]);
		const trackedChanges = statusResult.stdout
			.split("\n")
			.filter((line) => line.trim().length > 0 && !line.startsWith("??"));
		if (trackedChanges.length > 0) {
			throw new Error("You have uncommitted changes. Please commit or stash them first.");
		}

		const currentBranchResult = await runGit(effectiveCwd, ["branch", "--show-current"]);
		const currentBranch = currentBranchResult.stdout;

		const actions: string[] = [];

		if (dryRun) {
			if (currentBranch === mainBranch) {
				actions.push(`Would push ${mainBranch} to origin/${branchName}`);
				actions.push(`Would reset ${mainBranch} to origin/${mainBranch}`);
				if (!createPr) actions.push(`Would checkout ${branchName}`);
			} else {
				actions.push(`Would push ${currentBranch} to origin/${branchName}`);
				if (createPr) {
					actions.push(`Would checkout ${mainBranch}`);
					actions.push(`Would delete local branch ${currentBranch}`);
				}
			}
			if (createPr) {
				actions.push(`Would create PR: "${prTitle}" (${branchName} -> ${mainBranch})`);
				if (autoMerge) actions.push("Would enable auto-merge");
			}
			return { data: { dryRun: true, actions, branchName, mainBranch, currentBranch } };
		}

		// Push the branch
		if (currentBranch === mainBranch) {
			const pushResult = await runGit(effectiveCwd, ["push", "-u", "origin", `${mainBranch}:${branchName}`]);
			if (pushResult.code !== 0) throw new Error(`git push failed: ${pushResult.stderr}`);

			await runGit(effectiveCwd, ["branch", "-u", `origin/${mainBranch}`]);
			await runGit(effectiveCwd, ["reset", "--hard", `origin/${mainBranch}`]);

			if (!createPr) {
				await runGit(effectiveCwd, ["checkout", branchName]);
			}
		} else {
			const pushResult = await runGit(effectiveCwd, ["push", "-u", "origin", `${currentBranch}:${branchName}`]);
			if (pushResult.code !== 0) throw new Error(`git push failed: ${pushResult.stderr}`);

			if (createPr) {
				await runGit(effectiveCwd, ["checkout", mainBranch]);
				await runGit(effectiveCwd, ["branch", "-d", currentBranch]);
			}
		}

		let prUrl: string | undefined;
		let prNumber: string | undefined;

		let mergeStrategy: string | undefined;

		if (createPr && prTitle) {
			const prCreateOutput = await runGh(effectiveCwd, [
				"pr",
				"create",
				"--base",
				mainBranch,
				"--head",
				branchName,
				"--title",
				prTitle,
				"--body",
				"",
				...repoArgs,
			]);
			prUrl = prCreateOutput.trim();

			prNumber = await fetchPrNumber(effectiveCwd, branchName, repoArgs);

			if (autoMerge && prNumber) {
				try {
					const repoSettings = await getRepoSettings(effectiveCwd, ghRepo);
					const mergeMode = repoSettings.allowMergeCommit ? "m" : repoSettings.allowRebaseMerge ? "r" : "s";
					await enableAutoMerge(effectiveCwd, mergeMode, ghRepo, prNumber);
					mergeStrategy = "auto-merge";
				} catch {
					// Auto-merge fails without branch protection rules. Fall back to direct merge.
					try {
						await manualMerge(effectiveCwd, ghRepo, prNumber);
						mergeStrategy = "direct-merge";
					} catch (mergeError) {
						mergeStrategy = `failed: ${(mergeError as Error).message}`;
					}
				}
			}
		}

		let hint: string | undefined;
		if (createPr && currentBranch === mainBranch) {
			if (mergeStrategy === "auto-merge") {
				hint = `Local main has been reset to origin/main. Auto-merge is enabled. Await CI with \`githubAwaitWorkflowRun\`. If CI passes, \`gitPull\` to fast-forward. If CI fails, \`gitSwitchBranch\` to the PR branch to fix.`;
			} else {
				hint = `Local main has been reset to origin/main. Merge the PR with \`githubApprovePr\`, then await CI with \`githubAwaitWorkflowRun\`. If CI passes, \`gitPull\` to fast-forward. If CI fails, \`gitSwitchBranch\` to the PR branch to fix.`;
			}
		}

		return {
			data: {
				branchName,
				mainBranch,
				currentBranch,
				pushed: true,
				prUrl,
				prNumber,
				autoMerge: autoMerge && !!prNumber,
				mergeStrategy,
				hint,
			},
		};
	},
};
