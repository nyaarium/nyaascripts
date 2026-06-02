import { describe, expect, it } from "bun:test";
import { advance, applyLoop, type CycleProgress, findStep, hashBody } from "./computeNext.ts";

const steps = ["propose", "audit", "triage", "rethink"];

describe("advance", () => {
	it("advances to the next step", () => {
		expect(advance(steps, "propose", 0)).toEqual({ kind: "advance", current: "audit", index: 1 });
	});
	it("reports lapEnd on the last step", () => {
		expect(advance(steps, "rethink", 3)).toEqual({ kind: "lapEnd" });
	});
	it("needs resolution when the current name is gone, suggesting via index", () => {
		expect(advance(steps, "gone", 2)).toEqual({ kind: "needsResolution", oldCurrent: "gone", suggested: "triage" });
	});
	it("throws on an empty step list", () => {
		expect(() => advance([], "x", 0)).toThrow("empty");
	});
	it("recovers to step 0 when the index fallback is not an integer", () => {
		expect(advance(steps, "gone", Number.NaN)).toEqual({
			kind: "needsResolution",
			oldCurrent: "gone",
			suggested: "propose",
		});
	});
});

describe("findStep", () => {
	it("resolves a step case-insensitively to its canonical casing", () => {
		expect(findStep(["Propose", "Audit"], "audit")).toBe("Audit");
	});
	it("returns null for an unknown step", () => {
		expect(findStep(["a", "b"], "z")).toBeNull();
	});
});

describe("applyLoop", () => {
	const base: CycleProgress = {
		name: "c",
		current: "rethink",
		index: 3,
		lap: 1,
		unchanged_laps: 0,
		body_hash: "H",
		status: "active",
	};

	it("wraps to the first step and bumps the lap", () => {
		const r = applyLoop(base, steps, "H2", 8);
		expect(r.progress.current).toBe("propose");
		expect(r.progress.index).toBe(0);
		expect(r.progress.lap).toBe(2);
		expect(r.progress.unchanged_laps).toBe(0);
		expect(r.lapLimitReached).toBe(false);
	});
	it("increments unchanged_laps when the body did not change", () => {
		expect(applyLoop(base, steps, "H", 8).progress.unchanged_laps).toBe(1);
	});
	it("allows the loop into the last permitted lap (laps 1..maxLaps)", () => {
		const r = applyLoop({ ...base, lap: 7 }, steps, "H2", 8);
		expect(r.progress.lap).toBe(8);
		expect(r.lapLimitReached).toBe(false);
	});
	it("flags lapLimitReached when the loop would exceed maxLaps", () => {
		const r = applyLoop({ ...base, lap: 8 }, steps, "H2", 8);
		expect(r.progress.lap).toBe(9);
		expect(r.lapLimitReached).toBe(true);
	});
	it("throws on an empty step list", () => {
		expect(() => applyLoop(base, [], "H2", 8)).toThrow("empty");
	});
});

describe("hashBody", () => {
	it("is stable and sensitive to change", () => {
		expect(hashBody("abc")).toBe(hashBody("abc"));
		expect(hashBody("abc")).not.toBe(hashBody("abd"));
	});
});
