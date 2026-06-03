import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { repoPathParam } from "../lib/repoSchema.ts";
import { resolveRepoCwd } from "../lib/resolveRepoCwd.ts";

const OutputLogCommitSchema = z.object({
	hash: z.string(),
	shortHash: z.string(),
	author: z.string(),
	email: z.string(),
	date: z.string(),
	message: z.string(),
	refs: z.array(z.string()).optional(),
});
const OutputLogDataSchema = z.array(OutputLogCommitSchema);

const OutputLogInfoSchema = z.object({
	outputPath: z.string(),
	outputPathAbs: z.string(),
	count: z.number().optional(),
	range: z.string().optional(),
	commits: z.number(),
});

function runGitLog(cwd: string, count: number | undefined, range: string | undefined): Promise<string> {
	return new Promise((resolve, reject) => {
		const env = { ...process.env, PAGER: "cat" };

		// Pipe-delimited fields: hash, shortHash, author, email, date, refs, body. {{{EOL}}} is a unique commit separator.
		const formatString = "%H|%h|%an|%ae|%ad|%D|%B{{{EOL}}}";

		const cmdArgs = ["log", `--pretty=format:${formatString}`, "--decorate"];
		if (count !== undefined) cmdArgs.splice(1, 0, `-n ${count}`);
		else if (range !== undefined) cmdArgs.push(range);

		const child = spawn("git", cmdArgs, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
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
			else reject(new Error(`Git log failed ${code}: ${stderr.trim()}`));
		});
		child.on("error", (e) => reject(e));
	});
}

export function parseCommitData(rawLogData: string): z.infer<typeof OutputLogCommitSchema>[] {
	const commitBlocks = rawLogData.split("{{{EOL}}}").filter((block) => block.trim());
	const commits: z.infer<typeof OutputLogCommitSchema>[] = [];

	for (const block of commitBlocks) {
		const lines = block.trim().split("\n");
		if (lines.length === 0) continue;
		const firstLine = lines[0];
		const parts = firstLine.split("|");
		if (parts.length < 6) continue;

		const [hash, shortHash, author, email, date, refsString, ...messageParts] = parts;
		const refs = refsString?.trim()
			? refsString
					.split(", ")
					.map((r) => r.trim())
					.filter(Boolean)
			: [];
		const messageLines = lines.slice(1);
		const fullMessage = messageLines.join("\n").trim();
		// messageParts catches the rare case where %B contains a pipe, causing the body to split across extra fields.
		const finalMessage = fullMessage || (messageParts.length > 0 ? messageParts.join("|").trim() : "");

		commits.push({
			hash: hash.trim(),
			shortHash: shortHash.trim(),
			author: author.trim(),
			email: email.trim(),
			date: date.trim(),
			message: finalMessage,
			refs: refs.length > 0 ? refs : undefined,
		});
	}
	return commits;
}

const schema = z.object({
	count: z
		.number()
		.int()
		.min(1)
		.max(10000)
		.optional()
		.describe(
			`
Number of log entries to fetch (mutually exclusive with range).
`.trim(),
		),
	range: z
		.string()
		.optional()
		.describe(
			`
Git range (single hash or hash..hash, mutually exclusive with count).
`.trim(),
		),
	repoPath: repoPathParam,
	outputPath: z
		.string()
		.optional()
		.describe(
			`
Optional path to write JSON output.

If provided, returns path info instead of full data.
`.trim(),
		),
});

export const gitLog = {
	name: "gitLog",
	title: "git-log",
	description: `
Fetch structured git log data.

Supports count mode (-n) or range mode (-r). Requires the MCP client root to be a local git repository. Uses local git, not GitHub API.
`.trim(),
	operation: "fetching git log",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { count, range, outputPath } = args;
		if (count !== undefined && range !== undefined) throw new Error("Cannot specify both count and range");
		if (count === undefined && range === undefined) throw new Error("Either count or range is required");

		const effectiveCwd = resolveRepoCwd(cwd, args.repoPath);
		const rawLogData = await runGitLog(effectiveCwd, count, range);
		const commits = parseCommitData(rawLogData);
		let data: unknown = OutputLogDataSchema.parse(commits);

		if (outputPath) {
			const outputPathAbs = resolve(outputPath);
			writeFileSync(outputPathAbs, JSON.stringify(data, null, 2));
			data = OutputLogInfoSchema.parse({
				outputPath,
				outputPathAbs,
				count,
				range,
				commits: (data as unknown[]).length,
			});
		}
		return { data };
	},
};
