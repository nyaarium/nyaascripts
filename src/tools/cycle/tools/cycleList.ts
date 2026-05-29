import { z } from "zod";
import { listCycleDefs, loadCycleDef } from "../lib/resolveCycleDef.ts";

const schema = z.object({});

const OutputSchema = z.object({
	cycles: z.array(
		z.object({
			name: z.string(),
			steps: z.array(z.string()).optional(),
			maxLaps: z.number().optional(),
			error: z.string().optional(),
		}),
	),
});

export const cycleList = {
	name: "cycleList",
	title: "cycle-list",
	description:
		"List the cycle definitions available in the nyaascripts cycles library, with each one's steps. Use this to discover what cycles you can run with cycleStart.",
	operation: "listing cycle definitions",
	async handler(_cwd: string, args: z.infer<typeof schema>) {
		schema.parse(args);
		const cycles = listCycleDefs().map((name) => {
			try {
				const def = loadCycleDef(name);
				return { name, steps: def.steps, maxLaps: def.maxLaps };
			} catch (error) {
				return { name, error: (error as Error).message };
			}
		});
		return { data: OutputSchema.parse({ cycles }) };
	},
};
