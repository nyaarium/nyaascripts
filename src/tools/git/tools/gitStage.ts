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

const OutputEntrySchema = z.object({
	path: z.string(),
	action: z.enum(["staged", "unstaged"]),
});

const OutputResultSchema = z.object({
	files: z.array(OutputEntrySchema),
	dryRun: z.boolean().optional(),
});

export function parseDryRunOutput(output: string, action: "staged" | "unstaged"): z.infer<typeof OutputEntrySchema>[] {
	const results: z.infer<typeof OutputEntrySchema>[] = [];
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// git add --dry-run outputs "add 'path'" or "remove 'path'"
		const match = trimmed.match(/^(?:add|remove) '(.+)'$/);
		if (match) {
			results.push({ path: match[1], action });
		}
	}
	return results;
}

const schema = z.object({
	paths: z
		.array(z.string())
		.min(1)
		.describe(
			`
File paths to stage or unstage, relative to the repo root.
`.trim(),
		),
	unstage: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, unstage files (git restore --staged) instead of staging them.
`.trim(),
		),
	repoPath: repoPathParam,
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would be staged/unstaged without actually doing it.
`.trim(),
		),
});

export const gitStage = {
	name: "gitStage",
	title: "git-stage",
	description: `
Stage or unstage files in the local git repository.

By default stages files (git add). Set unstage to true to unstage files (git restore --staged).
`.trim(),
	operation: "staging files",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { paths, unstage = false, dryRun = false } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);
		const action = unstage ? "unstaged" : "staged";

		if (dryRun && !unstage) {
			const result = await runGit(effectiveCwd, ["add", "--dry-run", "--", ...paths]);
			if (result.code !== 0) throw new Error(`git add --dry-run failed: ${result.stderr}`);
			const files = parseDryRunOutput(result.stdout, action);
			return { data: OutputResultSchema.parse({ files, dryRun }) };
		}

		if (dryRun && unstage) {
			// git restore --staged has no dry-run flag, so verify the files are staged
			const statusResult = await runGit(effectiveCwd, ["status", "--porcelain", "--", ...paths]);
			if (statusResult.code !== 0) throw new Error(`git status failed: ${statusResult.stderr}`);
			const files: z.infer<typeof OutputEntrySchema>[] = [];
			for (const line of statusResult.stdout.split("\n")) {
				if (!line) continue;
				const indexStatus = line[0];
				// Files with a non-space, non-? index status are staged
				if (indexStatus !== " " && indexStatus !== "?") {
					files.push({ path: line.slice(3), action });
				}
			}
			return { data: OutputResultSchema.parse({ files, dryRun }) };
		}

		if (unstage) {
			const result = await runGit(effectiveCwd, ["restore", "--staged", "--", ...paths]);
			if (result.code !== 0) throw new Error(`git restore --staged failed: ${result.stderr}`);
		} else {
			const result = await runGit(effectiveCwd, ["add", "--", ...paths]);
			if (result.code !== 0) throw new Error(`git add failed: ${result.stderr}`);
		}

		const files = paths.map((p) => ({ path: p, action }));
		return { data: OutputResultSchema.parse({ files }) };
	},
};
