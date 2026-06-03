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

const StashEntrySchema = z.object({
	index: z.number(),
	name: z.string(),
	description: z.string(),
});

const OutputSchema = z.object({
	stashes: z.array(StashEntrySchema),
});

export function parseStashList(output: string): z.infer<typeof OutputSchema> {
	if (!output) return { stashes: [] };
	const stashes = output.split("\n").map((line) => {
		// Format: stash@{0}: On branch: message
		const match = line.match(/^stash@\{(\d+)\}:\s*(.+)$/);
		if (!match) return { index: 0, name: "", description: line };
		return { index: Number.parseInt(match[1], 10), name: "", description: match[2] };
	});
	// Extract stash name from "On branch: name" pattern if present
	for (const s of stashes) {
		const nameMatch = s.description.match(/^On \S+:\s*(.+)$/);
		if (nameMatch) s.name = nameMatch[1];
	}
	return { stashes };
}

const schema = z.object({
	repoPath: repoPathParam,
});

export const gitStashList = {
	name: "gitStashList",
	title: "git-stash-list",
	description: `
List all stashes in the local git repository.
`.trim(),
	operation: "listing stashes",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);
		const result = await runGit(effectiveCwd, ["stash", "list"]);
		if (result.code !== 0) throw new Error(`git stash list failed: ${result.stderr}`);

		return { data: OutputSchema.parse(parseStashList(result.stdout)) };
	},
};
