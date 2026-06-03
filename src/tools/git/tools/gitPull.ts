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

const OutputFileChangeSchema = z.object({
	path: z.string(),
	insertions: z.number(),
	deletions: z.number(),
});

const OutputPullSchema = z.object({
	success: z.boolean(),
	alreadyUpToDate: z.boolean(),
	mergeStrategy: z.string().nullable(),
	fromRef: z.string().nullable(),
	toRef: z.string().nullable(),
	filesChanged: z.number(),
	insertions: z.number(),
	deletions: z.number(),
	files: z.array(OutputFileChangeSchema),
	conflicts: z.array(z.string()),
	rawOutput: z.string(),
});

export function parsePullOutput(stdout: string, stderr: string, code: number): z.infer<typeof OutputPullSchema> {
	const combined = `${stderr}\n${stdout}`.trim();
	const alreadyUpToDate = /Already up to date/.test(stdout);

	if (alreadyUpToDate) {
		return OutputPullSchema.parse({
			success: true,
			alreadyUpToDate: true,
			mergeStrategy: null,
			fromRef: null,
			toRef: null,
			filesChanged: 0,
			insertions: 0,
			deletions: 0,
			files: [],
			conflicts: [],
			rawOutput: combined,
		});
	}

	// Parse ref range from "Updating abc123..def456"
	let fromRef: string | null = null;
	let toRef: string | null = null;
	const updateMatch = combined.match(/Updating\s+(\w+)\.\.(\w+)/);
	if (updateMatch) {
		fromRef = updateMatch[1];
		toRef = updateMatch[2];
	}

	// Parse merge strategy from "Fast-forward" or "Merge made by the 'ort' strategy."
	let mergeStrategy: string | null = null;
	if (/Fast-forward/.test(combined)) {
		mergeStrategy = "fast-forward";
	} else {
		const strategyMatch = combined.match(/Merge made by the '(\w+)' strategy/);
		if (strategyMatch) mergeStrategy = strategyMatch[1];
	}

	// Parse file changes from shortstat line: " 3 files changed, 10 insertions(+), 2 deletions(-)"
	let filesChanged = 0;
	let insertions = 0;
	let deletions = 0;
	const statMatch = combined.match(
		/(\d+) files? changed(?:,\s*(\d+) insertions?\(\+\))?(?:,\s*(\d+) deletions?\(-\))?/,
	);
	if (statMatch) {
		filesChanged = Number.parseInt(statMatch[1], 10);
		if (statMatch[2]) insertions = Number.parseInt(statMatch[2], 10);
		if (statMatch[3]) deletions = Number.parseInt(statMatch[3], 10);
	}

	// Parse per-file changes: " src/file.ts | 10 ++++---"
	const files: z.infer<typeof OutputFileChangeSchema>[] = [];
	for (const fileMatch of combined.matchAll(/^\s+(.+?)\s+\|\s+(\d+)\s+(\+*)(-*)/gm)) {
		files.push({
			path: fileMatch[1].trim(),
			insertions: fileMatch[3].length,
			deletions: fileMatch[4].length,
		});
	}

	// Parse conflicts from "CONFLICT (content): Merge conflict in <file>"
	const conflicts: string[] = [];
	for (const conflictMatch of combined.matchAll(/CONFLICT\s+\([^)]+\):\s+Merge conflict in\s+(.+)/g)) {
		conflicts.push(conflictMatch[1].trim());
	}

	const success = code === 0 && conflicts.length === 0;

	return OutputPullSchema.parse({
		success,
		alreadyUpToDate: false,
		mergeStrategy,
		fromRef,
		toRef,
		filesChanged,
		insertions,
		deletions,
		files,
		conflicts,
		rawOutput: combined,
	});
}

const schema = z.object({
	repoPath: repoPathParam,
});

export const gitPull = {
	name: "gitPull",
	title: "git-pull",
	description: `
Pull changes from the remote for the current branch.

Returns structured output with merge strategy, file changes, and any conflicts.
`.trim(),
	operation: "pulling from remote",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);
		const result = await runGit(effectiveCwd, ["pull"]);
		const data = parsePullOutput(result.stdout, result.stderr, result.code);

		if (!data.success) {
			throw new Error(
				`git pull failed: ${data.conflicts.length > 0 ? `conflicts in: ${data.conflicts.join(", ")}` : result.stderr}`,
			);
		}

		return { data };
	},
};
