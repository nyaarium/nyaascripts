import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { InputCommitSchema, normalizeCommitMessage, OutputCommitSchema, OutputInfoSchema } from "../lib/schemas.ts";

const schema = z.object({
	repo: z
		.string()
		.optional()
		.describe(
			`
When provided, must be full OWNER/REPO.

Leave out unless targeting another repo.
`.trim(),
		),
	commitHash: z.string().describe(
		`
The commit hash to fetch (full or short).
`.trim(),
	),
	outputPath: z
		.string()
		.optional()
		.describe(
			`
Optional path to write JSON output (relative or absolute).

If provided, returns path info instead of full data.
`.trim(),
		),
});

export const githubFetchCommit = {
	name: "githubFetchCommit",
	title: "github-fetch-commit",
	description: `
Fetch GitHub commit data.
`.trim(),
	operation: "fetching commit",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { repo, commitHash, outputPath } = args;
		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		const data = await new Promise((promiseResolve, reject) => {
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
				if (code !== 0) {
					reject(new Error(`GitHub API failed with code ${code}: ${stderr.trim()}`));
					return;
				}
				try {
					const rawData = JSON.parse(stdout);
					const validatedData = InputCommitSchema.parse(rawData);
					const messageLines = validatedData.commit.message.split("\n");
					const messageHeadline = messageLines[0];
					const messageBody = messageLines.slice(1).join("\n").trim() || null;
					const message = normalizeCommitMessage(messageHeadline, messageBody);

					const transformedData = {
						id: validatedData.sha,
						date: validatedData.commit.author.date,
						author: validatedData.commit.author.name,
						message,
						files: validatedData.files.map((file) => ({
							filename: file.filename,
							status: file.status,
							urlWeb: file.blob_url,
							urlRaw: file.raw_url,
							patch: file.patch || null,
						})),
					};
					const validatedCommitData = OutputCommitSchema.parse(transformedData);

					if (outputPath) {
						const outputPathAbs = resolve(outputPath);
						writeFileSync(outputPathAbs, JSON.stringify(validatedCommitData, null, 2));
						promiseResolve(OutputInfoSchema.parse({ outputPath, outputPathAbs }));
					} else {
						promiseResolve(validatedCommitData);
					}
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});

			child.on("error", (err) => reject(err));
		});

		return { data };
	},
};
