import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

export function buildCreateArgs(args: {
	title: string;
	body?: string;
	labels?: string[];
	assignees?: string[];
	repo?: string;
}): string[] {
	const cmdArgs = ["issue", "create", "--title", args.title, "--body", args.body ?? ""];
	if (args.repo) cmdArgs.push("--repo", args.repo);
	if (args.labels?.length) {
		for (const label of args.labels) {
			cmdArgs.push("--label", label);
		}
	}
	if (args.assignees?.length) {
		for (const assignee of args.assignees) {
			cmdArgs.push("--assignee", assignee);
		}
	}
	return cmdArgs;
}

const schema = z.object({
	title: z
		.string()
		.min(1)
		.describe(
			`
Issue title.
`.trim(),
		),
	body: z
		.string()
		.optional()
		.describe(
			`
Issue body (markdown).
`.trim(),
		),
	labels: z
		.array(z.string())
		.optional()
		.describe(
			`
Labels to add to the issue.
`.trim(),
		),
	assignees: z
		.array(z.string())
		.optional()
		.describe(
			`
GitHub usernames to assign.
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
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would be created without actually creating.
`.trim(),
		),
});

export const githubCreateIssue = {
	name: "githubCreateIssue",
	title: "github-create-issue",
	description: `
Create a new GitHub issue with optional labels and assignees.

Mutating action.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { title, body, labels, assignees, repo, dryRun = false } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		if (dryRun) {
			return {
				data: {
					dryRun: true,
					message: `Would create issue: "${title}"`,
					title,
					body: body ?? "",
					labels: labels ?? [],
					assignees: assignees ?? [],
				},
			};
		}

		const cmdArgs = buildCreateArgs({ title, body, labels, assignees, repo });
		const issueUrl = await runGh(cwd, cmdArgs);

		return {
			data: {
				issueUrl: issueUrl.trim(),
				title,
				message: "Issue created.",
			},
		};
	},
};
