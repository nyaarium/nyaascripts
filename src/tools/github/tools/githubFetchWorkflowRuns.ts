import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

const OutputRunSchema = z.object({
	databaseId: z.number(),
	displayTitle: z.string(),
	workflowName: z.string(),
	event: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	headBranch: z.string(),
	headSha: z.string(),
	url: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	attempt: z.number(),
});

const InputRunSchema = z.object({
	databaseId: z.number(),
	displayTitle: z.string(),
	workflowName: z.string().optional().default(""),
	event: z.string(),
	status: z.string(),
	conclusion: z.string().nullable().optional().default(null),
	headBranch: z.string(),
	headSha: z.string(),
	url: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	attempt: z.number().optional().default(1),
});

export function transformRuns(raw: z.infer<typeof InputRunSchema>[]): z.infer<typeof OutputRunSchema>[] {
	return raw.map((r) =>
		OutputRunSchema.parse({
			databaseId: r.databaseId,
			displayTitle: r.displayTitle,
			workflowName: r.workflowName ?? "",
			event: r.event,
			status: r.status,
			conclusion: r.conclusion ?? null,
			headBranch: r.headBranch,
			headSha: r.headSha,
			url: r.url,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
			attempt: r.attempt ?? 1,
		}),
	);
}

const schema = z.object({
	branch: z.string().describe(
		`
Branch name to filter workflow runs by (required).
`.trim(),
	),
	repo: z
		.string()
		.optional()
		.describe(
			`
Full OWNER/REPO. Leave out for current repo.
`.trim(),
		),
	status: z
		.enum([
			"queued",
			"in_progress",
			"completed",
			"action_required",
			"cancelled",
			"failure",
			"neutral",
			"skipped",
			"stale",
			"success",
			"timed_out",
			"waiting",
		])
		.optional()
		.describe(
			`
Filter by run status.
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
Max number of runs to return.
`.trim(),
		),
});

export const githubFetchWorkflowRuns = {
	name: "githubFetchWorkflowRuns",
	title: "github-fetch-workflow-runs",
	description: `
List GitHub Actions workflow runs filtered by branch.

Returns run IDs, status, conclusion, workflow name, and timing for each run.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { branch, repo, status, limit = 20 } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		const cmdArgs = [
			"run",
			"list",
			"--branch",
			branch,
			"--limit",
			String(limit),
			"--json",
			"databaseId,displayTitle,workflowName,event,status,conclusion,headBranch,headSha,url,createdAt,updatedAt,attempt",
		];
		if (status) cmdArgs.push("--status", status);
		if (repo) cmdArgs.push("--repo", repo);

		const raw = await runGh(cwd, cmdArgs);
		const parsed = z.array(InputRunSchema).parse(JSON.parse(raw));
		const runs = transformRuns(parsed);

		return { data: { runs, branch, total: runs.length } };
	},
};
