import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

const RunStatusSchema = z.object({
	status: z.string(),
	conclusion: z.string().nullable().optional(),
});

export function isTerminalStatus(status: string): boolean {
	return status === "completed";
}

const schema = z.object({
	runId: z.string().describe(
		`
The workflow run ID to poll.
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
	pollIntervalSeconds: z
		.number()
		.int()
		.min(10)
		.max(120)
		.optional()
		.default(30)
		.describe(
			`
Seconds between polls (default 30).
`.trim(),
		),
	maxWaitSeconds: z
		.number()
		.int()
		.min(60)
		.max(7200)
		.optional()
		.default(1800)
		.describe(
			`
Maximum seconds to wait before timing out (default 1800 = 30min).
`.trim(),
		),
});

export const githubAwaitWorkflowRun = {
	name: "githubAwaitWorkflowRun",
	title: "github-await-workflow-run",
	description: `
Poll a GitHub Actions workflow run until it completes (success or failure).

Returns the final status and conclusion.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { runId, repo, pollIntervalSeconds = 30, maxWaitSeconds = 1800 } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		const repoArgs = repo ? ["--repo", repo] : [];
		const startTime = Date.now();
		let polls = 0;

		while (true) {
			const elapsed = (Date.now() - startTime) / 1000;
			if (elapsed >= maxWaitSeconds) {
				return {
					data: {
						runId,
						status: "timeout",
						conclusion: null,
						elapsedSeconds: Math.round(elapsed),
						polls,
						timedOut: true,
					},
				};
			}

			const raw = await runGh(cwd, ["run", "view", runId, "--json", "status,conclusion", ...repoArgs]);
			const runStatus = RunStatusSchema.parse(JSON.parse(raw));
			polls++;

			if (isTerminalStatus(runStatus.status)) {
				return {
					data: {
						runId,
						status: runStatus.status,
						conclusion: runStatus.conclusion ?? null,
						elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
						polls,
						timedOut: false,
					},
				};
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalSeconds * 1000));
		}
	},
};
