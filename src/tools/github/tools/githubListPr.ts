import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { InputAuthorSchema, OutputInfoSchema } from "../lib/schemas.ts";

const InputMergeCommitSchema = z.object({ oid: z.string() });
const InputPRStatusCheckSchema = z.object({
	__typename: z.string(),
	completedAt: z.string().nullable().optional(),
	conclusion: z.string().nullable().optional(),
	detailsUrl: z.string().nullable().optional(),
	name: z.string(),
	startedAt: z.string().nullable().optional(),
	status: z.string(),
	workflowName: z.string().nullable().optional(),
});
const InputPRListBriefSchema = z.object({
	number: z.number(),
	state: z.string(),
	author: InputAuthorSchema,
	title: z.string(),
	mergeStateStatus: z.string().optional(),
	mergedAt: z.string().nullable().optional(),
	mergeCommit: InputMergeCommitSchema.nullable().optional(),
	statusCheckRollup: z.array(InputPRStatusCheckSchema).nullable().optional(),
});

const OutputPRStatusCheckSchema = z.object({
	__typename: z.string(),
	completedAt: z.string().nullable().optional(),
	conclusion: z.string().nullable().optional(),
	detailsUrl: z.string().nullable().optional(),
	name: z.string(),
	startedAt: z.string().nullable().optional(),
	status: z.string(),
	workflowName: z.string().nullable().optional(),
});
const OutputPRListBriefSchema = z.object({
	number: z.number(),
	state: z.string(),
	author: z.string(),
	title: z.string(),
	mergeStateStatus: z.string().nullable().optional(),
	mergedAt: z.string().nullable().optional(),
	mergeCommit: z.string().nullable().optional(),
	statusCheckRollup: z.array(OutputPRStatusCheckSchema).nullable().optional(),
});

type OutputPRListBrief = z.infer<typeof OutputPRListBriefSchema>;

async function fetchPrListBrief(
	cwd: string,
	repo: string | undefined,
	state: string,
	limit: number,
): Promise<OutputPRListBrief[]> {
	return new Promise((resolve, reject) => {
		const cmdArgs = [
			"pr",
			"list",
			"--state",
			state,
			"--limit",
			String(limit),
			"--json",
			"number,title,state,author,mergeStateStatus,mergedAt,mergeCommit,statusCheckRollup",
		];
		if (repo) cmdArgs.splice(2, 0, "--repo", repo);

		const child = spawn("gh", cmdArgs, {
			stdio: ["ignore", "pipe", "pipe"],
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
			if (code !== 0) {
				reject(new Error(`GitHub CLI failed ${code}: ${stderr.trim()}`));
				return;
			}
			try {
				const raw = JSON.parse(stdout);
				const validated = z.array(InputPRListBriefSchema).parse(raw);
				const data = validated.map((pr) => ({
					number: pr.number,
					state: pr.state,
					author: pr.author.name ?? pr.author.login,
					title: pr.title,
					mergeStateStatus: pr.mergeStateStatus ?? null,
					mergedAt: pr.mergedAt ?? null,
					mergeCommit: pr.mergeCommit?.oid ?? null,
					statusCheckRollup: pr.statusCheckRollup ?? null,
				}));
				resolve(data);
			} catch (e) {
				reject(new Error(`Parse PR list: ${(e as Error).message}`));
			}
		});
		child.on("error", (e) => reject(e));
	});
}

const schema = z.object({
	repo: z
		.string()
		.optional()
		.describe(
			`
When provided, must be full OWNER/REPO. Leave out unless targeting another repo.
`.trim(),
		),
	state: z
		.enum(["open", "closed", "merged", "all"])
		.optional()
		.default("open")
		.describe(
			`
Filter by PR state.
`.trim(),
		),
	limit: z
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.default(20)
		.describe(
			`
Max number of PRs to return.
`.trim(),
		),
	outputPath: z
		.string()
		.optional()
		.describe(
			`
Optional path to write JSON output. If provided, returns path info instead of full data.
`.trim(),
		),
});

export const githubListPr = {
	name: "githubListPr",
	title: "github-list-pr",
	description: `
Brief listing of GitHub pull requests.

Returns: number, title, state, author, mergeStateStatus, mergedAt, mergeCommit, statusCheckRollup. Use to find PRs by title and spot mergability or status checks. For full details use github-fetch-pr with a specific PR id.
`.trim(),
	operation: "listing PRs",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { repo, state = "open", limit = 20, outputPath } = args;
		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		let data: unknown = await fetchPrListBrief(cwd, repo, state, limit);
		data = z.array(OutputPRListBriefSchema).parse(data);

		if (outputPath) {
			const outputPathAbs = resolve(outputPath);
			writeFileSync(outputPathAbs, JSON.stringify(data, null, 2));
			data = OutputInfoSchema.parse({ outputPath, outputPathAbs });
		}
		return { data };
	},
};
