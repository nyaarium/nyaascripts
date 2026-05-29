import { z } from "zod";
import { applyLoop, type CycleProgress } from "../lib/computeNext.ts";
import { notifyCycleEnd } from "../lib/notify.ts";
import { appendStepCall, bodyHashOf, loadCycleRun, type StoredProgress, writeProgress } from "../lib/run.ts";

const schema = z.object({
	plan: z.string().describe("Path to the subject doc."),
	decision: z.enum(["done", "loop", "critical-stop"]).describe("End-of-lap decision."),
	summary: z.string().min(1).describe("1-2 sentences: what this lap did and the outcome."),
	acknowledgeOverrun: z
		.boolean()
		.optional()
		.default(false)
		.describe("Required to loop past the cycle's maxLaps soft cap."),
	dryRun: z.boolean().optional().default(false).describe("Report the decision's effect without writing."),
});

const OutputSchema = z.object({
	plan: z.string(),
	cycle: z.string(),
	decision: z.string(),
	status: z.string(),
	lap: z.number(),
	step: z.string(),
	lapLimitReached: z.boolean().optional(),
	unchangedLaps: z.number().optional(),
	instructions: z.string(),
	nextAction: z.string(),
	dryRun: z.boolean().optional(),
});

export const cycleCheckpoint = {
	name: "cycleCheckpoint",
	title: "cycle-checkpoint",
	description:
		"Make the end-of-lap decision after the last step: done | loop | critical-stop, with a 1-2 sentence summary. `loop` wraps to the first step and bumps the lap (refused past the maxLaps soft cap unless acknowledgeOverrun is set); `done` and `critical-stop` mark the cycle finished/stopped. Fires the notify hook after the write.",
	operation: "deciding at a lap checkpoint",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { plan, decision, summary, acknowledgeOverrun, dryRun } = schema.parse(args);
		const { subject, progress, def, steps, instructions } = loadCycleRun(cwd, plan, { requireActive: true });
		const core: CycleProgress = {
			name: progress.name,
			current: progress.current,
			index: progress.index,
			lap: progress.lap,
			unchanged_laps: progress.unchanged_laps,
			body_hash: progress.body_hash,
			status: "active",
		};

		if (decision === "loop") {
			const looped = applyLoop(core, steps, bodyHashOf(subject.content), def.maxLaps);
			if (looped.lapLimitReached && !acknowledgeOverrun) {
				const result = {
					plan,
					cycle: progress.name,
					decision,
					status: "active",
					lap: progress.lap,
					step: progress.current,
					lapLimitReached: true,
					unchangedLaps: progress.unchanged_laps,
					instructions: `Reached the soft cap of ${def.maxLaps} laps (unchanged for ${progress.unchanged_laps}). Prefer decision="done" unless you have a concrete, named gap.`,
					nextAction: `To continue anyway: cycleCheckpoint({ plan: "${plan}", decision: "loop", summary, acknowledgeOverrun: true }).`,
				};
				return { data: OutputSchema.parse(result) };
			}
			const next: StoredProgress = looped.progress;
			writeProgress(subject, next, dryRun);
			if (!dryRun) {
				notifyCycleEnd({ decision, summary, plan, cycle: progress.name, lap: next.lap, status: "active" });
			}
			const result = {
				plan,
				cycle: progress.name,
				decision,
				status: "active",
				lap: next.lap,
				step: next.current,
				unchangedLaps: next.unchanged_laps,
				instructions: appendStepCall(instructions(next.current), plan, next.current),
				nextAction: `New lap ${next.lap}. Do the work for step "${next.current}", then call cycleNext({ plan: "${plan}", completed: "${next.current}" }) to continue.`,
				...(dryRun ? { dryRun: true } : {}),
			};
			return { data: OutputSchema.parse(result) };
		}

		const status = decision === "done" ? "done" : "stopped";
		const next: StoredProgress = {
			...core,
			status,
			summary,
			...(decision === "done" ? { converged_at_lap: progress.lap } : {}),
		};
		writeProgress(subject, next, dryRun);
		if (!dryRun) {
			notifyCycleEnd({ decision, summary, plan, cycle: progress.name, lap: progress.lap, status });
		}
		const result = {
			plan,
			cycle: progress.name,
			decision,
			status,
			lap: progress.lap,
			step: progress.current,
			instructions: summary,
			nextAction:
				decision === "done"
					? `Cycle "${progress.name}" marked done. Reopen with cycleGoto if more work appears.`
					: `Cycle "${progress.name}" stopped. Resolve the critical issue, then reopen with cycleGoto.`,
			...(dryRun ? { dryRun: true } : {}),
		};
		return { data: OutputSchema.parse(result) };
	},
};
