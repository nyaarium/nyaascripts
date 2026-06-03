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
	branch: z.string().describe(
		`
Branch name to switch to (local or remote tracking).
`.trim(),
	),
	repoPath: repoPathParam,
});

export const gitSwitchBranch = {
	name: "gitSwitchBranch",
	title: "git-switch-branch",
	description: `
Switch the local working tree to an existing branch (local or remote tracking).
`.trim(),
	operation: "switching branch",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { branch } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		// Check for uncommitted changes
		const statusResult = await runGit(effectiveCwd, ["status", "-s"]);
		if (statusResult.stdout) {
			throw new Error("You have uncommitted changes. Please commit or stash them first.");
		}

		const result = await runGit(effectiveCwd, ["switch", branch]);
		if (result.code !== 0) {
			// Try with --track for remote branches
			const trackResult = await runGit(effectiveCwd, ["switch", "--track", `origin/${branch}`]);
			if (trackResult.code !== 0) {
				throw new Error(`git switch failed: ${result.stderr}`);
			}
		}

		const currentResult = await runGit(effectiveCwd, ["branch", "--show-current"]);

		return {
			data: {
				branch: currentResult.stdout,
				switched: true,
			},
		};
	},
};
