import { createHash } from "node:crypto";

export type CycleStatus = "active" | "done" | "stopped";

export interface CycleProgress {
	name: string;
	current: string;
	index: number;
	lap: number;
	unchanged_laps: number;
	body_hash: string;
	status: CycleStatus;
}

export type AdvanceResult =
	| { kind: "advance"; current: string; index: number }
	| { kind: "lapEnd" }
	| { kind: "needsResolution"; oldCurrent: string; suggested: string };

// Resolve a step name against the canonical list, case-insensitively, returning the canonical
// casing (or null). Callers that take a user-supplied step (e.g. goto) should store the result
// so a later case-sensitive advance() never misses.
export function findStep(steps: string[], name: string): string | null {
	const target = name.trim().toLowerCase();
	return steps.find((s) => s.toLowerCase() === target) ?? null;
}

// Locate the current step by name; the stored index is only a fallback hint for recovery.
export function advance(steps: string[], current: string, indexFallback: number): AdvanceResult {
	if (steps.length === 0) throw new Error("cannot advance an empty step list");
	const idx = steps.indexOf(current);
	if (idx === -1) {
		// A non-integer fallback (e.g. a hand-corrupted index in the front matter) recovers to 0.
		const safe = Number.isInteger(indexFallback) ? indexFallback : 0;
		const clamped = Math.min(Math.max(safe, 0), steps.length - 1);
		return { kind: "needsResolution", oldCurrent: current, suggested: steps[clamped] };
	}
	if (idx < steps.length - 1) return { kind: "advance", current: steps[idx + 1], index: idx + 1 };
	return { kind: "lapEnd" };
}

export function hashBody(body: string): string {
	return createHash("sha1").update(body).digest("hex").slice(0, 16);
}

export interface LoopResult {
	progress: CycleProgress;
	lapLimitReached: boolean;
}

// Wrap to the first step, bump the lap, and refresh the convergence signal (unchanged_laps
// counts consecutive laps whose body did not change). Caller gates the actual write on
// lapLimitReached unless the agent acknowledged the overrun. Note: this is a byte-equality
// fixed-point detector. unchanged_laps == 0 means "the body changed", not "real progress was
// made" - cosmetic churn (a reworded sentence) keeps it at 0, so callers must not treat 0 as
// proof of progress; the soft maxLaps cap is the backstop against churn-without-convergence.
export function applyLoop(progress: CycleProgress, steps: string[], newBodyHash: string, maxLaps: number): LoopResult {
	if (steps.length === 0) throw new Error("cannot loop an empty step list");
	const lap = progress.lap + 1;
	const unchanged = newBodyHash === progress.body_hash ? progress.unchanged_laps + 1 : 0;
	return {
		progress: {
			...progress,
			current: steps[0],
			index: 0,
			lap,
			unchanged_laps: unchanged,
			body_hash: newBodyHash,
			status: "active",
		},
		// Laps are 1-indexed (lap 1 is the first lap), so a loop into lap maxLaps+1 trips the cap;
		// laps 1..maxLaps are allowed.
		lapLimitReached: lap > maxLaps,
	};
}
