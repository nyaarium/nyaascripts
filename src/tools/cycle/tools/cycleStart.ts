import { z } from "zod";
import { appendStepCall, bodyHashOf, readSubject, resolveDef, type StoredProgress, writeProgress } from "../lib/run.ts";

const schema = z.object({
	plan: z.string().describe("Path to the subject doc (relative to the project root) that carries cycle progress."),
	cycle: z.string().describe("Name of the cycle definition to run (a *.md in the nyaascripts cycles library)."),
	force: z.boolean().optional().default(false).describe("Restart even if the subject already has an active cycle."),
	dryRun: z.boolean().optional().default(false).describe("Report what would be initialized without writing."),
});

const OutputSchema = z.object({
	plan: z.string(),
	cycle: z.string(),
	step: z.string(),
	index: z.number(),
	total: z.number(),
	lap: z.number(),
	status: z.string(),
	steps: z.array(z.string()),
	instructions: z.string(),
	dryRun: z.boolean().optional(),
});

export const cycleStart = {
	name: "cycleStart",
	title: "cycle-start",
	description:
		"Initialize a cycle on a subject doc. Loads the named cycle definition from the nyaascripts cycles library, validates it, writes the starting progress block into the subject doc's front matter, and returns the first step's instructions. Refuses to clobber an already-active cycle unless force is set.",
	operation: "starting a cycle",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { plan, cycle, force, dryRun } = schema.parse(args);
		const subject = readSubject(cwd, plan);

		// Protect an existing run (active, or corrupted-but-present) before loading the new def.
		if (!force) {
			if (subject.progress?.status === "active") {
				throw new Error(
					`subject already running cycle "${subject.progress.name}" (active, lap ${subject.progress.lap}). Pass force:true to restart.`,
				);
			}
			if (subject.malformed) {
				throw new Error("subject has a malformed cycle block; pass force:true to overwrite it.");
			}
		}

		const { def, instructions } = resolveDef(cycle);
		const steps = def.steps;
		const progress: StoredProgress = {
			name: cycle,
			current: steps[0],
			index: 0,
			lap: 0,
			unchanged_laps: 0,
			body_hash: bodyHashOf(subject.content),
			status: "active",
		};
		writeProgress(subject, progress, dryRun);

		const result = {
			plan,
			cycle,
			step: steps[0],
			index: 0,
			total: steps.length,
			lap: 0,
			status: "active",
			steps,
			instructions: appendStepCall(instructions(steps[0]), plan, steps[0]),
			...(dryRun ? { dryRun: true } : {}),
		};
		return { data: OutputSchema.parse(result) };
	},
};
