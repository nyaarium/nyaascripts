import type { CycleStatus } from "./computeNext.ts";

export interface CycleEndEvent {
	decision: "done" | "loop" | "critical-stop";
	summary: string;
	plan: string;
	cycle: string;
	lap: number;
	status: CycleStatus;
}

// Extension point. The end-of-lap checkpoint calls this after the progress write succeeds, so a
// notification failure can never corrupt cycle state. Wire audio alerts / Discord here later;
// critical-stop is the high-signal event. Kept side-effect-free by default.
export function notifyCycleEnd(_event: CycleEndEvent): void {
	// no-op stub
}
