import { z } from "zod";
import { bodyHashOf, readSubject, resolveDef } from "../lib/run.ts";

const schema = z.object({
	plan: z.string().describe("Path to the subject doc."),
});

const OutputSchema = z.object({
	plan: z.string(),
	initialized: z.boolean(),
	cycle: z.string().optional(),
	step: z.string().optional(),
	index: z.number().optional(),
	total: z.number().optional(),
	lap: z.number().optional(),
	status: z.string().optional(),
	unchangedLaps: z.number().optional(),
	bodyChangedSinceLastLap: z.boolean().optional(),
	instructions: z.string().optional(),
	malformed: z.boolean().optional(),
	error: z.string().optional(),
});

export const cycleStatus = {
	name: "cycleStatus",
	title: "cycle-status",
	description:
		"Report where a subject is in its cycle without mutating anything: current step, index, lap, status, and the convergence signal. Use this to resume, or to tell whether a cycle finished, stopped, or stalled.",
	operation: "reading cycle status",
	schema,
	async handler(cwd: string, args: z.infer<typeof schema>) {
		const { plan } = schema.parse(args);
		const subject = readSubject(cwd, plan);
		if (!subject.progress) {
			return {
				data: OutputSchema.parse({
					plan,
					initialized: false,
					...(subject.malformed ? { malformed: true, error: "cycle block is present but malformed" } : {}),
				}),
			};
		}
		const progress = subject.progress;
		const base = {
			plan,
			initialized: true,
			cycle: progress.name,
			step: progress.current,
			index: progress.index,
			lap: progress.lap,
			status: progress.status,
			unchangedLaps: progress.unchanged_laps,
			bodyChangedSinceLastLap: bodyHashOf(subject.content) !== progress.body_hash,
		};
		// Status is the diagnostic tool, so it must not throw when the definition drifted or vanished.
		try {
			const { def, instructions } = resolveDef(progress.name);
			const known = def.steps.includes(progress.current);
			return {
				data: OutputSchema.parse({
					...base,
					total: def.steps.length,
					...(known
						? { instructions: instructions(progress.current) }
						: {
								error: `current step "${progress.current}" is no longer in cycle "${progress.name}"; steps: ${def.steps.join(", ")}`,
							}),
				}),
			};
		} catch (error) {
			return { data: OutputSchema.parse({ ...base, error: (error as Error).message }) };
		}
	},
};
