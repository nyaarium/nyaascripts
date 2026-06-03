import { z } from "zod";
import {
	approvePR,
	enableAutoMerge,
	getCIStatus,
	getCurrentUser,
	getExistingApproval,
	getPRAuthor,
	getPRStatus,
	getRepoSettings,
	manualMerge,
} from "../lib/approvePr.ts";
import { checkGHCLI } from "../lib/checkGHCLI.ts";

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
	prNumbers: z
		.array(z.string())
		.min(1)
		.describe(
			`
Array of PR numbers to approve (e.g. ['123', '456']).
`.trim(),
		),
	merge: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
Whether to merge the PR after approval (auto-merge if enabled, manual merge otherwise).
`.trim(),
		),
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			`
If true, report what would be done without actually approving or merging.
`.trim(),
		),
});

export const githubApprovePr = {
	name: "githubApprovePr",
	title: "github-approve-pr",
	description: `
Approve and optionally merge GitHub pull requests.

Supports multiple PR numbers.

If a PR has author "app/dependabot" and mergeStateStatus is DIRTY, use github-pr-comment to post "@dependabot recreate" first, then approve/merge.

Mutating action.
`.trim(),
	operation: "approving PR(s)",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { repo, prNumbers, merge: shouldMerge = false, dryRun = false } = args;
		const ghStatus = await checkGHCLI(cwd);
		if (!ghStatus.available) throw new Error(`GitHub CLI not found: ${ghStatus.error}`);
		if (!ghStatus.authenticated) throw new Error(`GitHub CLI not authenticated: ${ghStatus.error}`);

		if (dryRun) {
			const actions = prNumbers.map((prNumber) => ({
				prNumber,
				wouldApprove: true,
				wouldMerge: shouldMerge,
			}));
			return { data: { dryRun: true, total: prNumbers.length, actions } };
		}

		const results: Record<string, unknown>[] = [];
		const errors: Record<string, unknown>[] = [];
		let repoSettings = null;
		if (shouldMerge) {
			try {
				repoSettings = await getRepoSettings(cwd, repo);
			} catch {
				// proceed without
			}
		}

		let currentUserLogin: string | undefined;
		try {
			const user = await getCurrentUser(cwd);
			currentUserLogin = (user as { login?: string }).login;
		} catch {
			// proceed without - self-approval detection will be skipped
		}

		for (const prNumber of prNumbers) {
			try {
				let alreadyApproved = false;
				let authWarning: string | null = null;
				let isOwnPr = false;

				// Check if this is the user's own PR
				if (currentUserLogin) {
					try {
						const prAuthor = await getPRAuthor(cwd, repo, prNumber);
						isOwnPr = prAuthor === currentUserLogin;
					} catch {
						// proceed without - will attempt approval normally
					}
				}

				if (isOwnPr) {
					// Cannot approve own PR - skip approval step
				} else {
					try {
						alreadyApproved = await getExistingApproval(cwd, repo, prNumber);
					} catch (e) {
						if (
							(e as Error).message?.includes("authenticated") ||
							(e as Error).message?.includes("NOT_AUTHENTICATED")
						) {
							authWarning = "GitHub CLI not authenticated - please run 'gh auth login'";
						}
					}
				}

				const result: Record<string, unknown> = isOwnPr
					? { success: true, prNumber, output: "Skipped approval (own PR)", skippedApproval: true }
					: alreadyApproved
						? { success: true, prNumber, output: "Already approved", skipped: true }
						: await approvePR(cwd, repo, prNumber);
				if (authWarning) result.authWarning = authWarning;
				results.push(result);

				if (shouldMerge) {
					try {
						const ciStatus = await getCIStatus(cwd, repo, prNumber);
						const prStatus = await getPRStatus(cwd, repo, prNumber);

						let mergeStrategy: string | null = null;
						let mergeMessage = "";
						let canProceed = true;

						if (repoSettings?.linearHistory) {
							if (repoSettings.allowAutoMerge) {
								mergeStrategy = "auto-merge";
								mergeMessage = "Linear history required - using auto-merge";
							} else {
								canProceed = false;
								mergeMessage = "Linear history required but auto-merge disabled. Rebase required.";
							}
						} else {
							if (ciStatus.overall === "success") {
								mergeStrategy = repoSettings?.allowAutoMerge ? "auto-merge" : "manual-merge";
								mergeMessage = "All checks passed - proceeding with merge";
							} else if (ciStatus.overall === "pending") {
								if (repoSettings?.allowAutoMerge) {
									mergeStrategy = "auto-merge";
									mergeMessage = `CI still running - auto-merge will complete after: ${ciStatus.stillRunning.map((c) => c.name).join(", ")}`;
								} else {
									canProceed = false;
									mergeMessage = `CI still running - manual merge blocked. Waiting for: ${ciStatus.stillRunning.map((c) => c.name).join(", ")}`;
								}
							} else if (ciStatus.overall === "failure") {
								// Some checks failed but required checks passed - auto-merge can still proceed and GitHub will enforce the required ones.
								if (ciStatus.required.length > 0 && repoSettings?.allowAutoMerge) {
									mergeStrategy = "auto-merge";
									mergeMessage = `CI has failures but required checks exist - auto-merge will proceed. Errors: ${ciStatus.errors.map((c) => c.name).join(", ")}`;
								} else {
									canProceed = false;
									mergeMessage = `CI failed - merge blocked. Errors: ${ciStatus.errors.map((c) => c.name).join(", ")}`;
								}
							} else {
								mergeStrategy = repoSettings?.allowAutoMerge ? "auto-merge" : "manual-merge";
								mergeMessage = "No CI checks found - proceeding with merge";
							}
						}

						if (canProceed && mergeStrategy) {
							try {
								if (mergeStrategy === "auto-merge") {
									if (repoSettings?.allowMergeCommit) {
										await enableAutoMerge(cwd, "m", repo, prNumber);
									} else if (repoSettings?.allowRebaseMerge) {
										await enableAutoMerge(cwd, "r", repo, prNumber);
									} else if (repoSettings?.allowSquashMerge) {
										await enableAutoMerge(cwd, "s", repo, prNumber);
									} else {
										await manualMerge(cwd, repo, prNumber);
									}
								} else {
									await manualMerge(cwd, repo, prNumber);
								}
								result.mergeResult = {
									strategy: mergeStrategy,
									message: mergeMessage,
									ciStatus,
									prStatus,
								};
							} catch (mergeErr) {
								const errMsg = (mergeErr as Error).message ?? "";
								const needsApproval =
									errMsg.includes("review is required") ||
									errMsg.includes("approved review") ||
									errMsg.includes("REVIEW_REQUIRED");
								if (isOwnPr && needsApproval) {
									result.mergeResult = {
										strategy: "awaiting-approval",
										message: "Own PR - merge will proceed once another user approves",
										ciStatus,
										prStatus,
									};
								} else {
									throw mergeErr;
								}
							}
						} else {
							result.mergeResult = {
								strategy: "blocked",
								message: mergeMessage,
								ciStatus,
								prStatus,
							};
							errors.push({
								prNumber,
								error: `Merge blocked: ${mergeMessage}`,
								ciStatus,
								prStatus,
							});
						}
					} catch (e) {
						errors.push({ prNumber, error: `Merge validation failed: ${(e as Error).message}` });
					}
				}
			} catch (e) {
				errors.push({ prNumber, error: (e as Error).message });
			}
		}

		const data = {
			total: prNumbers.length,
			successful: results.length,
			failed: errors.length,
			repositorySettings: shouldMerge ? repoSettings : null,
			results,
			errors,
		};
		return { data };
	},
};
