import fs from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomicWrite.ts";
import { hashSubjectBody } from "./computeNext.ts";
import { extractSection } from "./extractSection.ts";
import { parseFrontMatter, type Scalar, upsertTopLevelBlock } from "./frontMatter.ts";
import { type CycleDef, loadCycleDef } from "./resolveCycleDef.ts";
import { resolvePlanPath } from "./resolvePlanPath.ts";

export const CYCLE_BLOCK_KEY = "cycle";

// The progress block persisted into the subject doc's front matter. The core 7 fields drive the
// state machine; summary/converged_at_lap are recorded only on a terminal checkpoint decision.
export const ProgressSchema = z.object({
	name: z.string().min(1),
	current: z.string().min(1),
	index: z.number().int().nonnegative(),
	lap: z.number().int().nonnegative(),
	unchanged_laps: z.number().int().nonnegative(),
	body_hash: z.string().min(1),
	status: z.enum(["active", "done", "stopped"]),
	summary: z.string().optional(),
	converged_at_lap: z.number().int().optional(),
});

export type StoredProgress = z.infer<typeof ProgressSchema>;

export interface Subject {
	planPath: string;
	content: string;
	mtimeMs?: number;
	progress: StoredProgress | null;
	// True when a `cycle:` block is present but fails schema validation. Lets callers distinguish
	// "corrupted run" from "no run" so a single bad field cannot be silently overwritten.
	malformed: boolean;
}

// Read a subject doc and its current progress block (null when uninitialized, missing, or malformed).
export function readSubject(cwd: string, plan: string): Subject {
	const planPath = resolvePlanPath(cwd, plan);
	if (!fs.existsSync(planPath)) {
		return { planPath, content: "", mtimeMs: undefined, progress: null, malformed: false };
	}
	const content = fs.readFileSync(planPath, "utf8");
	const mtimeMs = fs.statSync(planPath).mtimeMs;
	const block = parseFrontMatter(content).fields[CYCLE_BLOCK_KEY];
	const present = block !== undefined && block !== null && typeof block === "object";
	const parsed = present ? ProgressSchema.safeParse(block) : null;
	const progress = parsed?.success ? parsed.data : null;
	return { planPath, content, mtimeMs, progress, malformed: present && !progress };
}

function toScalarRecord(progress: StoredProgress): Record<string, Scalar> {
	const record: Record<string, Scalar> = {
		name: progress.name,
		current: progress.current,
		index: progress.index,
		lap: progress.lap,
		unchanged_laps: progress.unchanged_laps,
		body_hash: progress.body_hash,
		status: progress.status,
	};
	if (progress.summary !== undefined) record.summary = progress.summary;
	if (progress.converged_at_lap !== undefined) record.converged_at_lap = progress.converged_at_lap;
	return record;
}

// Render the new content with the progress block written, and persist it atomically (unless
// dryRun). The mtime guard refuses the write if the file changed since it was read.
export function writeProgress(subject: Subject, progress: StoredProgress, dryRun: boolean): string {
	const next = upsertTopLevelBlock(subject.content, CYCLE_BLOCK_KEY, toScalarRecord(progress));
	if (!dryRun) {
		writeFileAtomic(subject.planPath, next, { expectedMtimeMs: subject.mtimeMs });
	}
	return next;
}

// Hash the subject body (excluding front matter) for the convergence signal.
export function bodyHashOf(content: string): string {
	return hashSubjectBody(content);
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
	return `${instructions}\n\n>> When this step's work is done, call cycleStep({ plan: "${plan}", completed: "${step}" }).`;
}

export function checkpointCall(plan: string): string {
	return `All steps complete. Call cycleCheckpoint({ plan: "${plan}", decision, summary }) with decision = "done" | "loop" | "critical-stop".`;
}
