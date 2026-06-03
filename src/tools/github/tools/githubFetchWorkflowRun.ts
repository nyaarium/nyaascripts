import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

const InputJobStepSchema = z.object({
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable().optional(),
	number: z.number(),
});

const InputJobSchema = z.object({
	databaseId: z.number(),
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable().optional(),
	startedAt: z.string().nullable().optional(),
	completedAt: z.string().nullable().optional(),
	url: z.string().optional().default(""),
	steps: z.array(InputJobStepSchema).optional().default([]),
});

const InputRunDetailSchema = z.object({
	databaseId: z.number(),
	displayTitle: z.string(),
	workflowName: z.string().optional().default(""),
	event: z.string(),
	status: z.string(),
	conclusion: z.string().nullable().optional(),
	headBranch: z.string(),
	headSha: z.string(),
	url: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	attempt: z.number().optional().default(1),
	jobs: z.array(InputJobSchema).optional().default([]),
});

const OutputJobStepSchema = z.object({
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	number: z.number(),
});

const OutputJobSchema = z.object({
	databaseId: z.number(),
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	url: z.string(),
	steps: z.array(OutputJobStepSchema),
});

const OutputRunDetailSchema = z.object({
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
	jobs: z.array(OutputJobSchema),
});

export function transformRunDetail(raw: z.infer<typeof InputRunDetailSchema>): z.infer<typeof OutputRunDetailSchema> {
	return OutputRunDetailSchema.parse({
		databaseId: raw.databaseId,
		displayTitle: raw.displayTitle,
		workflowName: raw.workflowName ?? "",
		event: raw.event,
		status: raw.status,
		conclusion: raw.conclusion ?? null,
		headBranch: raw.headBranch,
		headSha: raw.headSha,
		url: raw.url,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		attempt: raw.attempt ?? 1,
		jobs: (raw.jobs ?? []).map((j) => ({
			databaseId: j.databaseId,
			name: j.name,
			status: j.status,
			conclusion: j.conclusion ?? null,
			startedAt: j.startedAt ?? null,
			completedAt: j.completedAt ?? null,
			url: j.url ?? "",
			steps: (j.steps ?? []).map((s) => ({
				name: s.name,
				status: s.status,
				conclusion: s.conclusion ?? null,
				number: s.number,
			})),
		})),
	});
}

const schema = z.object({
	runId: z.string().describe(
		`
The workflow run ID to fetch details for.
`.trim(),
	),
	repo: z
		.string()
		.optional()
		.describe(
			`
Full OWNER/REPO.

Leave out for current repo.
`.trim(),
		),
	jobName: z
		.string()
		.optional()
		.describe(
			`
If provided, fetch logs for this specific job only.

Must match a job name from the run.
`.trim(),
		),
});

export const githubFetchWorkflowRun = {
	name: "githubFetchWorkflowRun",
	title: "github-fetch-workflow-run",
	description: `
Fetch details for a single GitHub Actions workflow run, including job breakdown with steps.

Optionally fetch logs for a specific job by name.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { runId, repo, jobName } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		const repoArgs = repo ? ["--repo", repo] : [];

		const raw = await runGh(cwd, [
			"run",
			"view",
			runId,
			"--json",
			"databaseId,displayTitle,workflowName,event,status,conclusion,headBranch,headSha,url,createdAt,updatedAt,attempt,jobs",
			...repoArgs,
		]);
		const parsed = InputRunDetailSchema.parse(JSON.parse(raw));
		const run = transformRunDetail(parsed);

		let jobLog: string | undefined;
		if (jobName) {
			const job = run.jobs.find((j) => j.name === jobName);
			if (!job) {
				const available = run.jobs.map((j) => j.name).join(", ");
				throw new Error(`Job "${jobName}" not found. Available jobs: ${available}`);
			}
			try {
				jobLog = await runGh(cwd, [
					"run",
					"view",
					runId,
					"--log",
					"--job",
					String(job.databaseId),
					...repoArgs,
				]);
			} catch (e) {
				jobLog = `[Failed to fetch logs: ${(e as Error).message}]`;
			}
		}

		return { data: { ...run, ...(jobLog !== undefined ? { jobLog } : {}) } };
	},
};
