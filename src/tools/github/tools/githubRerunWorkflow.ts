import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

const schema = z.object({
	runId: z.string().describe(
		`
The workflow run ID to re-run.
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
	onlyFailed: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, only re-run failed jobs instead of the entire workflow.
`.trim(),
		),
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would be done without actually re-running.
`.trim(),
		),
});

export const githubRerunWorkflow = {
	name: "githubRerunWorkflow",
	title: "github-rerun-workflow",
	description: `
Re-run a GitHub Actions workflow run.

Can re-run all jobs or only failed jobs. Mutating action.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { runId, repo, onlyFailed = false, dryRun = false } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		if (dryRun) {
			return {
				data: {
					dryRun: true,
					runId,
					message: onlyFailed
						? `Would re-run only failed jobs for run ${runId}`
						: `Would re-run all jobs for run ${runId}`,
				},
			};
		}

		const repoArgs = repo ? ["--repo", repo] : [];
		const cmdArgs = ["run", "rerun", runId, ...repoArgs];
		if (onlyFailed) cmdArgs.push("--failed");

		await runGh(cwd, cmdArgs);

		return {
			data: {
				runId,
				rerun: true,
				onlyFailed,
				message: onlyFailed
					? `Re-running failed jobs for run ${runId}`
					: `Re-running all jobs for run ${runId}`,
			},
		};
	},
};
