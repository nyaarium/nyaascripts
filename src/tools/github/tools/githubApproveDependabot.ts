import { z } from "zod";
import { approvePR, enableAutoMerge, getRepoSettings } from "../lib/approvePr.ts";
import { checkGHCLI } from "../lib/checkGHCLI.ts";
import { runGh } from "../lib/runGh.ts";

const InputPRListItemSchema = z.object({
	number: z.number(),
	isDraft: z.boolean(),
	author: z.object({ login: z.string() }),
	title: z.string(),
});

const OWN_LIB_PATTERNS = [
	" js-common from",
	" next-common from",
	" react-controlled-input from",
	" react-layout-engine from",
];

export function filterDependabotPRs(
	prs: z.infer<typeof InputPRListItemSchema>[],
	options: { approveOwnLibs: boolean; approveDistUpdates: boolean },
): z.infer<typeof InputPRListItemSchema>[] {
	return prs.filter((pr) => {
		if (pr.isDraft) return false;

		if (pr.author.login === "app/dependabot") {
			if (!options.approveOwnLibs && OWN_LIB_PATTERNS.some((p) => pr.title.includes(p))) return false;
			return true;
		}

		if (options.approveDistUpdates && pr.title.includes("Update dist/ files")) return true;

		return false;
	});
}

const schema = z.object({
	repo: z
		.string()
		.optional()
		.describe(
			`
Full OWNER/REPO.

Leave out for current repo.
`.trim(),
		),
	approveOwnLibs: z
		.boolean()
		.optional()
		.default(true)
		.describe(
			`
Whether to approve Dependabot PRs for own common libs (js-common, next-common, etc).
`.trim(),
		),
	approveDistUpdates: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
Whether to approve 'Update dist/ files' PRs.
`.trim(),
		),
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would be approved without actually approving.
`.trim(),
		),
});

export const githubApproveDependabot = {
	name: "githubApproveDependabot",
	title: "github-approve-dependabot",
	description: `
Batch-approve open Dependabot pull requests.

Enables auto-merge, approves, and posts @dependabot recreate if the branch is behind base.

Optionally approves own-lib and dist/ update PRs.
`.trim(),
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { repo, approveOwnLibs = true, approveDistUpdates = false, dryRun = false } = args;

		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		const repoArgs = repo ? ["--repo", repo] : [];

		const prListRaw = await runGh(cwd, [
			"pr",
			"list",
			"--limit",
			"100",
			"--state",
			"open",
			"--json",
			"number,isDraft,author,title",
			...repoArgs,
		]);
		const prList = z.array(InputPRListItemSchema).parse(JSON.parse(prListRaw));
		const toApprove = filterDependabotPRs(prList, { approveOwnLibs, approveDistUpdates });

		const approved: { number: number; title: string; recreated: boolean }[] = [];
		const skipped: { number: number; title: string; reason: string }[] = [];
		const errors: { number: number; title: string; error: string }[] = [];

		if (dryRun) {
			for (const pr of toApprove) {
				approved.push({ number: pr.number, title: pr.title, recreated: false });
			}
			const approveNumbers = new Set(toApprove.map((p) => p.number));
			for (const pr of prList) {
				if (!approveNumbers.has(pr.number)) {
					const reason = pr.isDraft
						? "draft"
						: pr.author.login !== "app/dependabot" && !pr.title.includes("Update dist/ files")
							? "not dependabot"
							: "filtered by options";
					skipped.push({ number: pr.number, title: pr.title, reason });
				}
			}
			return { data: { approved, skipped, errors, dryRun: true } };
		}

		const repoSettings = await getRepoSettings(cwd, repo);
		const mergeMode = repoSettings.allowMergeCommit ? "m" : repoSettings.allowRebaseMerge ? "r" : "s";

		for (const pr of toApprove) {
			try {
				await enableAutoMerge(cwd, mergeMode, repo, String(pr.number));
				await approvePR(cwd, repo, String(pr.number));

				let recreated = false;
				if (pr.author.login === "app/dependabot") {
					try {
						const prDetailsRaw = await runGh(cwd, [
							"pr",
							"view",
							String(pr.number),
							"--json",
							"headRefName,baseRefName",
							...repoArgs,
						]);
						const prDetails = JSON.parse(prDetailsRaw) as { headRefName: string; baseRefName: string };
						const { headRefName, baseRefName } = prDetails;

						const comparePath = repo
							? `repos/${repo}/compare/${baseRefName}...${headRefName}`
							: `repos/{owner}/{repo}/compare/${baseRefName}...${headRefName}`;
						const behindStr = await runGh(cwd, ["api", comparePath, "--jq", ".behind_by"]);
						const behindBy = Number.parseInt(behindStr.trim(), 10);

						if (!Number.isNaN(behindBy) && behindBy > 0) {
							await runGh(cwd, [
								"pr",
								"comment",
								String(pr.number),
								"--body",
								"@dependabot recreate",
								...repoArgs,
							]);
							recreated = true;
						}
					} catch {
						// Non-fatal: approve succeeded, recreate check failed
					}
				}

				approved.push({ number: pr.number, title: pr.title, recreated });
			} catch (e) {
				errors.push({ number: pr.number, title: pr.title, error: (e as Error).message });
			}
		}

		return { data: { approved, skipped, errors } };
	},
};
