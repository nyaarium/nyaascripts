import { spawn } from "node:child_process";
import { z } from "zod";
import { repoPathParam } from "../lib/repoSchema.ts";
import { resolveRepoCwd } from "../lib/resolveRepoCwd.ts";

function runGit(
	cwd: string,
	args: string[],
	stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {
			stdio: [stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
			env: { ...process.env, PAGER: "cat" },
			cwd,
		});
		let stdout = "";
		let stderr = "";
		child.stdout!.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr!.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 }));
		child.on("error", (e) => resolve({ stdout: "", stderr: e.message, code: 1 }));
		if (stdin != null) {
			child.stdin!.write(stdin);
			child.stdin!.end();
		}
	});
}

const OutputResultSchema = z.object({
	hash: z.string(),
	branch: z.string(),
	summary: z.string(),
	dryRun: z.boolean().optional(),
});

export function parseCommitOutput(output: string): { hash: string; branch: string; summary: string } {
	// git commit output: [branch hash] summary
	// e.g. "[main e0db4f3] Add host session tools"
	const match = output.match(/^\[(\S+)\s+([a-f0-9]+)\]\s+(.+)$/m);
	if (match) {
		return { branch: match[1], hash: match[2], summary: match[3] };
	}
	return { branch: "", hash: "", summary: output };
}

const schema = z.object({
	message: z
		.string()
		.min(1)
		.describe(
			"Commit message. One short phrase or sentence. Verb first, no prefixes. Describe only what changed, not process. Don't include plan/cycle/slice/lap labels or progress narrative anywhere (not at the front, not at the end), e.g. \"(slice 4)\", \"(some phase name)\". The only allowed trailing parenthetical is an issue link. Do not use words like \"fix\" unless the human has confirmed the change is the correct solution; for unverified attempts, use words like \"attempt\" or \"try\" instead. If related to issues, end with (fixes #N) for bugfixes, (closes #N) for completed tasks, (related #N) to link without closing.",
		),
	repoPath: repoPathParam,
	amend: z
		.boolean()
		.optional()
		.default(false)
		.describe("If true, amend the previous commit instead of creating a new one."),
	dryRun: z.boolean().optional().default(false).describe("If true, report what would be committed without doing it."),
});

export const gitCommit = {
	name: "gitCommit",
	title: "git-commit",
	description:
		"Create a git commit with the currently staged files. Prefer short, human-readable commit messages. Consider whether staged changes are a confirmed solution or an exploratory attempt, and reflect that in the message.",
	operation: "creating commit",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { message, amend = false, dryRun = false } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		const gitArgs = ["commit"];
		if (amend) gitArgs.push("--amend");
		if (dryRun) gitArgs.push("--dry-run");
		gitArgs.push("-F", "-");

		if (dryRun) {
			const result = await runGit(effectiveCwd, gitArgs, message);
			if (result.code !== 0) throw new Error(`git commit --dry-run failed: ${result.stderr}`);
			return {
				data: OutputResultSchema.parse({
					hash: "(dry-run)",
					branch: "",
					summary: result.stdout,
					dryRun,
				}),
			};
		}

		const result = await runGit(effectiveCwd, gitArgs, message);
		if (result.code !== 0) throw new Error(`git commit failed: ${result.stderr}`);

		const parsed = parseCommitOutput(result.stdout);
		return { data: OutputResultSchema.parse(parsed) };
	},
};
