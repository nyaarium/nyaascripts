import { spawn } from "node:child_process";
import { type Message, OpenRouterClient } from "openrouter-kit";
import { z } from "zod";
import { repoPathParam } from "../lib/repoSchema.ts";
import { resolveRepoCwd } from "../lib/resolveRepoCwd.ts";

function runGitLog(cwd: string, days: number, author?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = ["log", `--since=${days} days ago`, "--pretty=format:%s"];
		if (author) args.push(`--author=${author}`);

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
		child.on("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(`git log failed (${code}): ${stderr.trim()}`));
		});
		child.on("error", (e) => reject(e));
	});
}

const schema = z.object({
	days: z
		.number()
		.int()
		.min(1)
		.max(365)
		.describe(
			`
Number of days of history to summarize.
`.trim(),
		),
	author: z
		.string()
		.optional()
		.describe(
			`
Git author name to filter by.

If omitted, includes all authors.
`.trim(),
		),
	repoPath: repoPathParam,
});

export const gitSummarizeActivity = {
	name: "gitSummarizeActivity",
	title: "git-summarize-activity",
	description: `
Fetch git log for a time period and summarize contributions using an LLM.

Requires the MCP client root to be a local git repository. Returns a bullet-point summary of activities.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { days, author } = args;
		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);

		const raw = await runGitLog(effectiveCwd, days, author);
		if (!raw) return { data: { summary: "No commits found for the specified period." } };

		const apiKey = process.env.OPENROUTER_KEY;
		if (!apiKey) throw new Error("OPENROUTER_KEY environment variable is required.");

		const orClient = new OpenRouterClient({ apiKey });

		const messages: Message[] = [
			{
				role: "system",
				content:
					"You are given a list of git commit messages. Summarize the user's general activities and contributions in unordered list format. For generic repeats like merging Dependabot PRs, combine them and give an estimated count. Sort by most significant.",
			},
			{ role: "user", content: raw },
		];

		const response = await orClient.chat({
			model: "openai/gpt-4o-mini",
			customMessages: messages,
		});

		const summary = response?.content?.trim() ?? "No summary generated.";
		return { data: { summary } };
	},
};
