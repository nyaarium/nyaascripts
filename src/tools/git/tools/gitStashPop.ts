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

const OutputSchema = z.object({
	popped: z.boolean(),
	name: z.string(),
	output: z.string(),
});

const schema = z.object({
	name: z
		.string()
		.min(1)
		.describe(
			`
The name of the stash to pop.
`.trim(),
		),
	repoPath: repoPathParam,
});

export const gitStashPop = {
	name: "gitStashPop",
	title: "git-stash-pop",
	description: `
Pop a stash by its name.

Finds the matching stash and applies it, removing it from the stash list.
`.trim(),
	operation: "popping stash",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { name } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		// Find the stash index by name
		const listResult = await runGit(effectiveCwd, ["stash", "list"]);
		if (listResult.code !== 0) throw new Error(`git stash list failed: ${listResult.stderr}`);

		let stashRef: string | null = null;
		if (listResult.stdout) {
			for (const line of listResult.stdout.split("\n")) {
				const match = line.match(/^(stash@\{\d+\}):\s*On \S+:\s*(.+)$/);
				if (match && match[2] === name) {
					stashRef = match[1];
					break;
				}
			}
		}

		if (!stashRef) {
			throw new Error(`No stash found with name "${name}".`);
		}

		const result = await runGit(effectiveCwd, ["stash", "pop", stashRef]);
		if (result.code !== 0) throw new Error(`git stash pop failed: ${result.stderr}`);

		return { data: OutputSchema.parse({ popped: true, name, output: result.stdout }) };
	},
};
