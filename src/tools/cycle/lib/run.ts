import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomicWrite.ts";
import { hashBody } from "./computeNext.ts";
import { extractSection } from "./extractSection.ts";
import { type CycleDef, loadCycleDef } from "./resolveCycleDef.ts";
import { resolvePlanPath } from "./resolvePlanPath.ts";

// Cycle progress lives in a JSON sidecar next to the plan, NOT in the plan itself, so the tools
// never touch the document the author is editing (no file-write race against pending body edits).
export const ProgressSchema = z.object({
	name: z.string().min(1),
	current: z.string().min(1),
	index: z.number().int().nonnegative(),
	lap: z.number().int().positive(),
	unchanged_laps: z.number().int().nonnegative(),
	body_hash: z.string().min(1),
	status: z.enum(["active", "done", "stopped"]),
	summary: z.string().optional(),
	converged_at_lap: z.number().int().optional(),
});

export type StoredProgress = z.infer<typeof ProgressSchema>;

// `plans/spring.md` -> `plans/spring.cycle.json`. A non-markdown plan keeps its name: `x.txt` ->
// `x.txt.cycle.json`.
export function sidecarPathFor(planPath: string): string {
	return `${planPath.replace(/\.(md|mdx|markdown)$/i, "")}.cycle.json`;
}

export interface Subject {
	planPath: string;
	sidecarPath: string;
	content: string; // the plan doc (for the convergence hash); "" if it does not exist yet
	sidecarMtimeMs?: number;
	progress: StoredProgress | null;
	// True when the sidecar exists but is unreadable/invalid. Lets callers distinguish "corrupted
	// run" from "no run" so a single bad field cannot be silently overwritten.
	malformed: boolean;
}

// Read the plan doc (for hashing) and its progress sidecar (null when uninitialized/missing/malformed).
export function readSubject(cwd: string, plan: string): Subject {
	const planPath = resolvePlanPath(cwd, plan);
	const sidecarPath = sidecarPathFor(planPath);

	if (fs.existsSync(sidecarPath) && fs.lstatSync(sidecarPath).isSymbolicLink()) {
		throw new Error(`refusing to use a symlinked cycle sidecar: ${path.basename(sidecarPath)}`);
	}

	const content = fs.existsSync(planPath) ? fs.readFileSync(planPath, "utf8") : "";

	let progress: StoredProgress | null = null;
	let malformed = false;
	let sidecarMtimeMs: number | undefined;
	if (fs.existsSync(sidecarPath)) {
		sidecarMtimeMs = fs.statSync(sidecarPath).mtimeMs;
		try {
			const parsed = ProgressSchema.safeParse(JSON.parse(fs.readFileSync(sidecarPath, "utf8")));
			if (parsed.success) progress = parsed.data;
			else malformed = true;
		} catch {
			malformed = true;
		}
	}

	return { planPath, sidecarPath, content, sidecarMtimeMs, progress, malformed };
}

// Persist progress to the sidecar atomically (unless dryRun). The mtime guard refuses the write if
// the sidecar changed since it was read.
export function writeProgress(subject: Subject, progress: StoredProgress, dryRun: boolean): void {
	if (dryRun) return;
	writeFileAtomic(subject.sidecarPath, `${JSON.stringify(progress, null, 2)}\n`, {
		expectedMtimeMs: subject.sidecarMtimeMs,
	});
}

// Hash the whole plan doc for the convergence signal. The tools never write the plan, so any change
// is the author's.
export function bodyHashOf(content: string): string {
	return hashBody(content);
}

export interface ResolvedDef {
	def: CycleDef;
	instructions(step: string): string;
}

// Load the definition a subject is running and give a step -> instructions resolver.
export function resolveDef(name: string): ResolvedDef {
	const def = loadCycleDef(name);
	return { def, instructions: (step: string) => extractSection(def.body, step) };
}

export interface CycleRun {
	subject: Subject;
	progress: StoredProgress;
	def: CycleDef;
	steps: string[];
	instructions(step: string): string;
}

// Single source of truth for "load a running cycle": the precondition bundle every stateful tool
// needs (subject exists, has a cycle, optionally active) plus its resolved definition. Keeping it
// here means the tools cannot drift on what counts as runnable or on the error wording.
export function loadCycleRun(cwd: string, plan: string, opts: { requireActive: boolean }): CycleRun {
	const subject = readSubject(cwd, plan);
	if (!subject.progress) throw new Error("no cycle on this subject; call cycleStart first");
	const progress = subject.progress;
	if (opts.requireActive && progress.status !== "active") {
		throw new Error(`cycle is ${progress.status}; reopen it with cycleGoto before continuing`);
	}
	const { def, instructions } = resolveDef(progress.name);
	return { subject, progress, def, steps: def.steps, instructions };
}

// The literal next call travels with the instructions so it stays in the agent's working context.
export function appendStepCall(instructions: string, plan: string, step: string): string {
	return `${instructions}\n\n>> When this step's work is done, call cycleNext({ plan: "${plan}", completed: "${step}" }) to conclude it and move to the next step. This is normal forward progress; do not use cycleGoto to advance.`;
}

export function checkpointCall(plan: string): string {
	return `All steps complete. Call cycleCheckpoint({ plan: "${plan}", decision, summary }) with decision = "done" | "loop" | "critical-stop".`;
}
