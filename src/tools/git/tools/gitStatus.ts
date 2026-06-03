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

const OutputFileEntrySchema = z.object({
	path: z.string(),
	status: z.string(),
});

const OutputStatusSchema = z.object({
	branch: z.string(),
	upstream: z.string().nullable(),
	ahead: z.number(),
	behind: z.number(),
	staged: z.array(OutputFileEntrySchema),
	unstaged: z.array(OutputFileEntrySchema),
	untracked: z.array(z.string()),
});

// Maps porcelain v2 status codes to human-readable labels
const STATUS_LABELS: Record<string, string> = {
	M: "modified",
	T: "type-changed",
	A: "added",
	D: "deleted",
	R: "renamed",
	C: "copied",
	U: "unmerged",
};

function statusLabel(code: string): string {
	return STATUS_LABELS[code] ?? code;
}

export function parseStatusOutput(output: string): z.infer<typeof OutputStatusSchema> {
	let branch = "";
	let upstream: string | null = null;
	let ahead = 0;
	let behind = 0;
	const staged: z.infer<typeof OutputFileEntrySchema>[] = [];
	const unstaged: z.infer<typeof OutputFileEntrySchema>[] = [];
	const untracked: string[] = [];

	for (const line of output.split("\n")) {
		if (!line) continue;

		if (line.startsWith("# branch.head ")) {
			branch = line.slice("# branch.head ".length);
		} else if (line.startsWith("# branch.upstream ")) {
			upstream = line.slice("# branch.upstream ".length);
		} else if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+) -(\d+)/);
			if (match) {
				ahead = Number.parseInt(match[1], 10);
				behind = Number.parseInt(match[2], 10);
			}
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// Ordinary (1) or rename/copy (2) changed entry
			// Format: 1 XY sub mH mI mW hH hI path
			// Format: 2 XY sub mH mI mW hH hI X\tscore path\torigPath
			const parts = line.split(" ");
			const xy = parts[1];
			const x = xy[0]; // staged status
			const y = xy[1]; // unstaged status

			let filePath: string;
			if (line.startsWith("2 ")) {
				// Rename entry has tab-separated path fields after the space-separated header
				const tabParts = line.split("\t");
				filePath = tabParts[1] ?? parts.slice(9).join(" ");
			} else {
				filePath = parts.slice(8).join(" ");
			}

			if (x !== ".") staged.push({ path: filePath, status: statusLabel(x) });
			if (y !== ".") unstaged.push({ path: filePath, status: statusLabel(y) });
		} else if (line.startsWith("u ")) {
			// Unmerged entry
			const parts = line.split(" ");
			const filePath = parts.slice(10).join(" ");
			staged.push({ path: filePath, status: "unmerged" });
		} else if (line.startsWith("? ")) {
			untracked.push(line.slice(2));
		}
	}

	return OutputStatusSchema.parse({ branch, upstream, ahead, behind, staged, unstaged, untracked });
}

const schema = z.object({
	repoPath: repoPathParam,
});

export const gitStatus = {
	name: "gitStatus",
	title: "git-status",
	description: `
Get the working tree status of the local git repository.

Returns branch name, upstream tracking info, ahead/behind counts, and lists of staged, unstaged, and untracked files.
`.trim(),
	operation: "fetching git status",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);
		const result = await runGit(effectiveCwd, ["status", "--porcelain=v2", "--branch"]);
		if (result.code !== 0) throw new Error(`git status failed: ${result.stderr}`);

		return { data: parseStatusOutput(result.stdout) };
	},
};
