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
	stashed: z.boolean(),
	name: z.string(),
	output: z.string(),
});

const schema = z.object({
	name: z
		.string()
		.min(1)
		.describe(
			`
A unique name for this stash.

Must not collide with an existing stash name.
`.trim(),
		),
	repoPath: repoPathParam,
});

export const gitStashPush = {
	name: "gitStashPush",
	title: "git-stash-push",
	description: `
Stash working tree changes with a required name.

Fails if a stash with the same name already exists.
`.trim(),
	operation: "stashing changes",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { name } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		// Check for duplicate stash name
		const listResult = await runGit(effectiveCwd, ["stash", "list"]);
		if (listResult.code !== 0) throw new Error(`git stash list failed: ${listResult.stderr}`);
		if (listResult.stdout) {
			for (const line of listResult.stdout.split("\n")) {
				const match = line.match(/^stash@\{\d+\}:\s*On \S+:\s*(.+)$/);
				if (match && match[1] === name) {
					throw new Error(`A stash with name "${name}" already exists. Choose a different name.`);
				}
			}
		}

		const result = await runGit(effectiveCwd, ["stash", "push", "-m", name]);
		if (result.code !== 0) throw new Error(`git stash push failed: ${result.stderr}`);

		const stashed = !result.stdout.includes("No local changes to save");
		return { data: OutputSchema.parse({ stashed, name, output: result.stdout }) };
	},
};
