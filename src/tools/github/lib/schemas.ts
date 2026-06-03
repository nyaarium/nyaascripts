import { spawn } from "node:child_process";
import { z } from "zod";

export const InputAuthorSchema = z.object({
	login: z.string(),
	name: z.string().nullable().optional(),
});

export const InputFileSchema = z.object({
	filename: z.string(),
	status: z.string(),
	blob_url: z.string(),
	raw_url: z.string(),
	patch: z.string().nullable().optional(),
});

export const InputCommitSchema = z.object({
	sha: z.string(),
	commit: z.object({
		author: z.object({
			name: z.string(),
			email: z.string(),
			date: z.string(),
		}),
		committer: z.object({
			name: z.string(),
			email: z.string(),
			date: z.string(),
		}),
		message: z.string(),
	}),
	author: InputAuthorSchema.nullable().optional(),
	committer: InputAuthorSchema.nullable().optional(),
	files: z.array(InputFileSchema),
	stats: z
		.object({
			total: z.number(),
			additions: z.number(),
			deletions: z.number(),
		})
		.optional(),
});

export const OutputFileSchema = z.object({
	filename: z.string(),
	status: z.string(),
	urlWeb: z.string(),
	urlRaw: z.string(),
	patch: z.string().nullable().optional(),
});

export const OutputCommitSchema = z.object({
	id: z.string(),
	date: z.string(),
	author: z.string(),
	message: z.string(),
	files: z.array(OutputFileSchema),
});

export const OutputInfoSchema = z.object({
	outputPath: z.string(),
	outputPathAbs: z.string(),
});

/** Returns the full message (headline + body) for normal commits. For Dependabot commits, returns the headline only. The body is verbose and not useful. */
export function normalizeCommitMessage(headline: string, body: string | null | undefined): string {
	const dependabotPatterns = [/^Bump .+ from .+ to .+$/i, /^Bump .+ group with .+$/i, /from .+\/dependabot\//i];
	const isDependabot = dependabotPatterns.some((p) => p.test(headline) || (body && p.test(body)));
	const message = body ? `${headline}\n${body}`.trim() : headline.trim();
	return isDependabot ? headline.trim() : message;
}

export type InputCommit = z.infer<typeof InputCommitSchema>;

/** Fetches a commit via `gh api`. When `repo` is undefined, uses `:owner/:repo` inference from the cwd. */
export function fetchCommitViaGh(cwd: string, repo: string | undefined, commitHash: string): Promise<InputCommit> {
	return new Promise((resolve, reject) => {
		const apiArgs = repo
			? ["api", `repos/${repo}/commits/${commitHash}`]
			: ["api", `repos/:owner/:repo/commits/${commitHash}`];
		const child = spawn("gh", apiArgs, {
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
			if (code === 0) {
				try {
					const raw = JSON.parse(stdout);
					resolve(InputCommitSchema.parse(raw));
				} catch (e) {
					reject(new Error(`Parse commit: ${(e as Error).message}`));
				}
			} else {
				reject(new Error(`gh api failed ${code}: ${stderr.trim()}`));
			}
		});
		child.on("error", (e) => reject(e));
	});
}
