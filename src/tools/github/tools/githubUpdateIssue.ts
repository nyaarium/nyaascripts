import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

export function buildEditArgs(args: {
	issueId: string;
	title?: string;
	body?: string;
	addLabels?: string[];
	removeLabels?: string[];
	assignees?: string[];
	repo?: string;
}): string[] {
	const cmdArgs = ["issue", "edit", args.issueId];
	if (args.repo) cmdArgs.push("--repo", args.repo);
	if (args.title) cmdArgs.push("--title", args.title);
	if (args.body !== undefined) cmdArgs.push("--body", args.body);
	if (args.addLabels?.length) cmdArgs.push("--add-label", args.addLabels.join(","));
	if (args.removeLabels?.length) cmdArgs.push("--remove-label", args.removeLabels.join(","));
	if (args.assignees?.length) cmdArgs.push("--add-assignee", args.assignees.join(","));
	return cmdArgs;
}

export function describeChanges(args: {
	issueId: string;
	state?: string;
	title?: string;
	body?: string;
	addLabels?: string[];
	removeLabels?: string[];
	assignees?: string[];
}): string[] {
	const changes: string[] = [];
	if (args.state === "closed") changes.push(`Would close issue #${args.issueId}`);
	if (args.state === "open") changes.push(`Would reopen issue #${args.issueId}`);
	if (args.title) changes.push(`Would update title to: "${args.title}"`);
	if (args.body !== undefined) changes.push("Would update body");
	if (args.addLabels?.length) changes.push(`Would add labels: ${args.addLabels.join(", ")}`);
	if (args.removeLabels?.length) changes.push(`Would remove labels: ${args.removeLabels.join(", ")}`);
	if (args.assignees?.length) changes.push(`Would assign: ${args.assignees.join(", ")}`);
	if (changes.length === 0) changes.push("No changes specified");
	return changes;
}

const schema = z.object({
	issueId: z.string().describe(
		`
The issue number to update.
`.trim(),
	),
	state: z
		.enum(["open", "closed"])
		.optional()
		.describe(
			`
Set issue state: close or reopen.
`.trim(),
		),
	title: z
		.string()
		.optional()
		.describe(
			`
New issue title.
`.trim(),
		),
	body: z
		.string()
		.optional()
		.describe(
			`
New issue body (markdown).
`.trim(),
		),
	addLabels: z
		.array(z.string())
		.optional()
		.describe(
			`
Labels to add.
`.trim(),
		),
	removeLabels: z
		.array(z.string())
		.optional()
		.describe(
			`
Labels to remove.
`.trim(),
		),
	assignees: z
		.array(z.string())
		.optional()
		.describe(
			`
GitHub usernames to add as assignees.
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
If true, report what would be changed without actually changing.
`.trim(),
		),
});

export const githubUpdateIssue = {
	name: "githubUpdateIssue",
	title: "github-update-issue",
	description: `
Update a GitHub issue: close/reopen, change title/body, add/remove labels, change assignees.

Mutating action.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { issueId, state, title, body, addLabels, removeLabels, assignees, repo, dryRun = false } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		if (dryRun) {
			const changes = describeChanges({ issueId, state, title, body, addLabels, removeLabels, assignees });
			return { data: { dryRun: true, issueId, changes } };
		}

		const repoArgs = repo ? ["--repo", repo] : [];
		const actions: string[] = [];

		// Handle state changes
		if (state === "closed") {
			await runGh(cwd, ["issue", "close", issueId, ...repoArgs]);
			actions.push("Closed");
		} else if (state === "open") {
			await runGh(cwd, ["issue", "reopen", issueId, ...repoArgs]);
			actions.push("Reopened");
		}

		// Handle edits (title, body, labels, assignees)
		const hasEdits = title || body !== undefined || addLabels?.length || removeLabels?.length || assignees?.length;
		if (hasEdits) {
			const editArgs = buildEditArgs({ issueId, title, body, addLabels, removeLabels, assignees, repo });
			await runGh(cwd, editArgs);
			if (title) actions.push("Updated title");
			if (body !== undefined) actions.push("Updated body");
			if (addLabels?.length) actions.push(`Added labels: ${addLabels.join(", ")}`);
			if (removeLabels?.length) actions.push(`Removed labels: ${removeLabels.join(", ")}`);
			if (assignees?.length) actions.push(`Assigned: ${assignees.join(", ")}`);
		}

		if (actions.length === 0) actions.push("No changes applied");

		return { data: { issueId, actions, message: "Issue updated." } };
	},
};
