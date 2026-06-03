import { spawn } from "node:child_process";
import { z } from "zod";
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

const schema = z.object({
	repoPath: repoPathParam,
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would be pushed without doing it.
`.trim(),
		),
});

export const gitPush = {
	name: "gitPush",
	title: "git-push",
	description: `
Push commits on the current branch to the remote.
`.trim(),
	operation: "pushing to remote",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { dryRun = false } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		const branchResult = await runGit(effectiveCwd, ["branch", "--show-current"]);
		const branch = branchResult.stdout;

		if (dryRun) {
			const result = await runGit(effectiveCwd, ["push", "--dry-run"]);
			if (result.code !== 0) {
				throw new Error(`git push --dry-run failed: ${result.stderr}`);
			}
			return { data: { dryRun: true, branch, output: result.stderr || result.stdout } };
		}

		const result = await runGit(effectiveCwd, ["push"]);

		if (result.code !== 0) {
			const combined = `${result.stderr}\n${result.stdout}`.trim();
			if (combined.includes("GH006") || combined.includes("protected branch")) {
				throw new Error(
					"Push rejected by branch protection. Use `gitPushNewBranch` to push to a new branch and create a PR instead.",
				);
			}
			throw new Error(`git push failed: ${combined}`);
		}

		return {
			data: {
				branch,
				pushed: true,
				output: result.stderr || result.stdout,
			},
		};
	},
};
