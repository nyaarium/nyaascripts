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

const OutputRefUpdateSchema = z.object({
	action: z.enum(["new-branch", "new-tag", "updated", "pruned", "forced-update"]),
	from: z.string().nullable(),
	to: z.string().nullable(),
	ref: z.string(),
});

const OutputFetchSchema = z.object({
	success: z.boolean(),
	remote: z.string(),
	updates: z.array(OutputRefUpdateSchema),
	rawStderr: z.string(),
});

export function parseFetchOutput(stderr: string): z.infer<typeof OutputFetchSchema> {
	const updates: z.infer<typeof OutputRefUpdateSchema>[] = [];
	let remote = "origin";

	for (const line of stderr.split("\n")) {
		const trimmed = line.trim();

		const fromMatch = trimmed.match(/^From\s+(.+)/);
		if (fromMatch) {
			remote = fromMatch[1];
			continue;
		}

		// Pruned ref: " x [deleted]         (none)     -> origin/branch-name"
		const prunedMatch = trimmed.match(/^x\s+\[deleted\]\s+(?:\(none\)\s+->\s+)?(.+)/);
		if (prunedMatch) {
			updates.push({ action: "pruned", from: null, to: null, ref: prunedMatch[1].trim() });
			continue;
		}

		// New branch: " * [new branch]      main       -> origin/main"
		const newBranchMatch = trimmed.match(/^\*\s+\[new branch\]\s+\S+\s+->\s+(.+)/);
		if (newBranchMatch) {
			updates.push({ action: "new-branch", from: null, to: null, ref: newBranchMatch[1].trim() });
			continue;
		}

		// New tag: " * [new tag]         v1.0       -> v1.0"
		const newTagMatch = trimmed.match(/^\*\s+\[new tag\]\s+\S+\s+->\s+(.+)/);
		if (newTagMatch) {
			updates.push({ action: "new-tag", from: null, to: null, ref: newTagMatch[1].trim() });
			continue;
		}

		// Forced update: " + abc123...def456 main       -> origin/main  (forced update)"
		const forcedMatch = trimmed.match(/^\+\s+(\w+)\.\.\.(\w+)\s+\S+\s+->\s+(.+?)\s+\(forced update\)/);
		if (forcedMatch) {
			updates.push({
				action: "forced-update",
				from: forcedMatch[1],
				to: forcedMatch[2],
				ref: forcedMatch[3].trim(),
			});
			continue;
		}

		// Normal update: "   abc123..def456  main       -> origin/main"
		const updateMatch = trimmed.match(/^(\w+)\.\.(\w+)\s+\S+\s+->\s+(.+)/);
		if (updateMatch) {
			updates.push({ action: "updated", from: updateMatch[1], to: updateMatch[2], ref: updateMatch[3].trim() });
		}
	}

	return { success: true, remote, updates, rawStderr: stderr };
}

const schema = z.object({
	repoPath: repoPathParam,
});

export const gitFetch = {
	name: "gitFetch",
	title: "git-fetch",
	description: `
Fetch from remote and prune deleted remote-tracking references.

Returns structured output showing new branches, updated refs, and pruned refs.
`.trim(),
	operation: "fetching from remote",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);
		const result = await runGit(effectiveCwd, ["fetch", "--prune"]);
		if (result.code !== 0) throw new Error(`git fetch failed: ${result.stderr}`);

		// git fetch writes progress/ref updates to stderr
		const data = parseFetchOutput(result.stderr);
		return { data };
	},
};
