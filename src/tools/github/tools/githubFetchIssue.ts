import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { OutputInfoSchema } from "../lib/schemas.ts";

const InputIssueAuthorSchema = z.object({
	login: z.string(),
	name: z.string().nullable().optional(),
});
const InputIssueCommentSchema = z.object({
	id: z.string(),
	author: InputIssueAuthorSchema,
	body: z.string(),
	createdAt: z.string(),
	updatedAt: z.string().nullable().optional(),
});
export const InputIssueSchema = z.object({
	number: z.number(),
	title: z.string(),
	body: z.string().nullable(),
	state: z.string(),
	stateReason: z.string().nullable().optional(),
	author: InputIssueAuthorSchema,
	assignees: z.array(InputIssueAuthorSchema),
	labels: z.array(
		z.object({
			id: z.string().optional(),
			name: z.string(),
			description: z.string().nullable().optional(),
			color: z.string().optional(),
		}),
	),
	comments: z.array(InputIssueCommentSchema),
	createdAt: z.string(),
	updatedAt: z.string(),
	closedAt: z.string().nullable(),
	isPinned: z.boolean().optional(),
});

const OutputIssueCommentSchema = z.object({
	id: z.string(),
	author: z.object({ login: z.string(), name: z.string().nullable().optional() }),
	body: z.string(),
	createdAt: z.string(),
	updatedAt: z.string().nullable().optional(),
});
const OutputIssueSchema = z.object({
	number: z.number(),
	title: z.string(),
	body: z.string().nullable(),
	state: z.string(),
	stateReason: z.string().nullable().optional(),
	author: z.string(),
	assignees: z.array(z.string()),
	labels: z.array(z.string()),
	comments: z.array(OutputIssueCommentSchema),
	createdAt: z.string(),
	updatedAt: z.string(),
	closedAt: z.string().nullable(),
	isPinned: z.boolean().optional(),
});

type InputIssue = z.infer<typeof InputIssueSchema>;

export function transformIssue(issue: InputIssue): z.infer<typeof OutputIssueSchema> {
	return {
		number: issue.number,
		title: issue.title,
		body: issue.body ?? null,
		state: issue.state,
		stateReason: issue.stateReason ?? null,
		author: issue.author?.name ?? issue.author?.login ?? "",
		assignees: (issue.assignees ?? []).map((a) => a?.name ?? a?.login ?? ""),
		labels: (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
		comments: (issue.comments ?? []).map((c) => ({
			id: c.id,
			author: { login: c.author?.login ?? "", name: c.author?.name ?? undefined },
			body: c.body,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt ?? undefined,
		})),
		createdAt: issue.createdAt,
		updatedAt: issue.updatedAt,
		closedAt: issue.closedAt ?? null,
		isPinned: issue.isPinned ?? false,
	};
}

async function fetchSingleIssue(
	cwd: string,
	repo: string | undefined,
	issueId: string,
): Promise<z.infer<typeof OutputIssueSchema>> {
	return new Promise((resolve, reject) => {
		const cmdArgs = [
			"issue",
			"view",
			issueId,
			"--json",
			"number,title,body,state,stateReason,author,assignees,labels,comments,createdAt,updatedAt,closedAt",
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
				const validated = InputIssueSchema.parse(raw);
				resolve(transformIssue(validated));
			} catch (e) {
				reject(new Error(`Parse issue: ${(e as Error).message}`));
			}
		});
		child.on("error", (e) => reject(e));
	});
}

async function fetchIssueList(
	cwd: string,
	repo: string | undefined,
	state: string,
	limit: number,
): Promise<z.infer<typeof OutputIssueSchema>[]> {
	return new Promise((resolve, reject) => {
		const cmdArgs = [
			"issue",
			"list",
			"--state",
			state,
			"--limit",
			String(limit),
			"--json",
			"number,title,body,state,stateReason,author,assignees,labels,comments,createdAt,updatedAt,closedAt,isPinned",
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
				const validated = z.array(InputIssueSchema).parse(raw);
				resolve(validated.map(transformIssue));
			} catch (e) {
				reject(new Error(`Parse issue list: ${(e as Error).message}`));
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
	issueId: z
		.string()
		.optional()
		.describe(
			`
The issue number to fetch. If not provided, fetches a list of issues.
`.trim(),
		),
	state: z
		.enum(["open", "closed", "all"])
		.optional()
		.default("all")
		.describe(
			`
Filter by issue state (only when fetching list).
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
Maximum number of issues to fetch (only when fetching list).
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

export const githubFetchIssue = {
	name: "githubFetchIssue",
	title: "github-fetch-issue",
	description: `
Fetch GitHub issues.

If issueId is provided, fetches a single issue; otherwise fetches a list. Returns detailed information including comments.
`.trim(),
	operation: "fetching issue(s)",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { repo, issueId, state = "all", limit = 20, outputPath } = args;
		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		let data: unknown;
		if (issueId) {
			data = await fetchSingleIssue(cwd, repo, issueId);
			data = OutputIssueSchema.parse(data);
		} else {
			data = await fetchIssueList(cwd, repo, state, limit);
			data = z.array(OutputIssueSchema).parse(data);
		}

		if (outputPath) {
			const outputPathAbs = resolve(outputPath);
			writeFileSync(outputPathAbs, JSON.stringify(data, null, 2));
			data = OutputInfoSchema.parse({ outputPath, outputPathAbs });
		}
		return { data };
	},
};
