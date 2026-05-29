import { z } from "zod";
import { advance, findStep } from "../lib/computeNext.ts";
import {
	appendStepCall,
	bodyHashOf,
	checkpointCall,
	loadCycleRun,
	type StoredProgress,
	writeProgress,
} from "../lib/run.ts";

const schema = z.object({
	plan: z.string().describe("Path to the subject doc."),
	completed: z
		.string()
		.optional()
		.describe(
			"Name of the step you just finished. Must match the current step; concluding it is what advances the cycle.",
		),
	dryRun: z.boolean().optional().default(false).describe("Report the next state without writing."),
});

const OutputSchema = z.object({
	plan: z.string(),
	cycle: z.string(),
	step: z.string(),
	index: z.number(),
	total: z.number(),
	lap: z.number(),
	status: z.string(),
	advanced: z.boolean(),
	lapEnd: z.boolean().optional(),
	needsResolution: z.boolean().optional(),
	suggested: z.string().optional(),
	unchangedLaps: z.number().optional(),
	bodyChangedSinceLastLap: z.boolean().optional(),
	instructions: z.string(),
	nextAction: z.string(),
	dryRun: z.boolean().optional(),
});

export const cycleNext = {
	name: "cycleNext",
	title: "cycle-next",
	description:
		"Conclude the step you just finished and move to the next one. This IS normal forward progress through a cycle: do the current step's work, then call cycleNext with `completed` set to that step's name. Concluding the step is the advance, so you never need cycleGoto to go forward. `completed` is required and must match the current step (a bare call only reports the current step and does not advance, so a forgotten name fails safe). Concluding the last step returns lapEnd and points at cycleCheckpoint. If the current step no longer exists in the definition, it returns needsResolution instead of guessing.",
	operation: "concluding a step",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { plan, completed, dryRun } = schema.parse(args);
		const { subject, progress, steps, instructions } = loadCycleRun(cwd, plan, { requireActive: true });
		const total = steps.length;
		const base = {
			plan,
			cycle: progress.name,
			total,
			lap: progress.lap,
			status: progress.status,
		};

		// Resolve the move first so a current step that vanished from the definition is detected
		// before we try to render its (now missing) instructions, regardless of `completed`.
		const move = advance(steps, progress.current, progress.index);
		if (move.kind === "needsResolution") {
			const result = {
				...base,
				step: progress.current,
				index: progress.index,
				advanced: false,
				needsResolution: true,
				suggested: move.suggested,
				instructions: `The step "${move.oldCurrent}" is no longer in cycle "${progress.name}". Steps are now: ${steps.join(", ")}.`,
				nextAction: `Call cycleGoto({ plan: "${plan}", step: "${move.suggested}" }) to resume at a valid step.`,
			};
			return { data: OutputSchema.parse(result) };
		}

		// Confirm-then-advance: only a matching `completed` advances; otherwise report current
		// (safe now that current is known to be in the definition).
		const confirmed = completed !== undefined && findStep(steps, completed) === progress.current;
		if (!confirmed) {
			const result = {
				...base,
				step: progress.current,
				index: progress.index,
				advanced: false,
				instructions: instructions(progress.current),
				nextAction: `Do the work for step "${progress.current}", then call cycleNext({ plan: "${plan}", completed: "${progress.current}" }) to conclude it and move on. (cycleNext is normal forward progress; you do not need cycleGoto to advance.)`,
			};
			return { data: OutputSchema.parse(result) };
		}

		if (move.kind === "lapEnd") {
			const bodyChanged = bodyHashOf(subject.content) !== progress.body_hash;
			const result = {
				...base,
				step: progress.current,
				index: progress.index,
				advanced: false,
				lapEnd: true,
				unchangedLaps: progress.unchanged_laps,
				bodyChangedSinceLastLap: bodyChanged,
				instructions: checkpointCall(plan),
				nextAction: checkpointCall(plan),
			};
			return { data: OutputSchema.parse(result) };
		}

		const next: StoredProgress = { ...progress, current: move.current, index: move.index };
		writeProgress(subject, next, dryRun);
		const result = {
			...base,
			step: move.current,
			index: move.index,
			advanced: true,
			instructions: appendStepCall(instructions(move.current), plan, move.current),
			nextAction: `Now do the work for step "${move.current}", then call cycleNext({ plan: "${plan}", completed: "${move.current}" }) to conclude it and continue.`,
			...(dryRun ? { dryRun: true } : {}),
		};
		return { data: OutputSchema.parse(result) };
	},
};
