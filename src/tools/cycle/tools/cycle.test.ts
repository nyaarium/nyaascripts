import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cycleCheckpoint } from "./cycleCheckpoint.ts";
import { cycleGoto } from "./cycleGoto.ts";
import { cycleList } from "./cycleList.ts";
import { cycleStart } from "./cycleStart.ts";
import { cycleStatus } from "./cycleStatus.ts";
import { cycleStep } from "./cycleStep.ts";

let cwd: string;
let cyclesDir: string;
const prevEnv = process.env.NYAASCRIPTS_CYCLES_DIR;

// biome-ignore lint/suspicious/noExplicitAny: test helper unwraps the tool's { data } envelope.
async function run(tool: { handler: (cwd: string, args: any) => Promise<unknown> }, args: any): Promise<any> {
	const out = (await tool.handler(cwd, args)) as { data: unknown };
	return out.data;
}

beforeAll(() => {
	cyclesDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cyclesdef-")));
	process.env.NYAASCRIPTS_CYCLES_DIR = cyclesDir;
	fs.writeFileSync(
		path.join(cyclesDir, "demo.md"),
		"---\nsteps: [a, b, c]\n---\n## a\nAlpha\n## b\nBeta\n## c\nGamma\n",
	);
	fs.writeFileSync(path.join(cyclesDir, "cap.md"), "---\nsteps: [x]\nmaxLaps: 1\n---\n## x\nOnly\n");
});

afterAll(() => {
	if (prevEnv === undefined) delete process.env.NYAASCRIPTS_CYCLES_DIR;
	else process.env.NYAASCRIPTS_CYCLES_DIR = prevEnv;
	fs.rmSync(cyclesDir, { recursive: true, force: true });
});

beforeEach(() => {
	cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cyclecwd-")));
});

describe("cycle tool lifecycle", () => {
	it("starts, steps, ends a lap, loops, and finishes", async () => {
		const start = await run(cycleStart, { plan: "plan.md", cycle: "demo" });
		expect(start.step).toBe("a");
		expect(start.status).toBe("active");
		expect(start.steps).toEqual(["a", "b", "c"]);
		expect(start.instructions).toContain("Alpha");
		expect(start.instructions).toContain('cycleStep({ plan: "plan.md", completed: "a" })');

		// Bare step (no completed) does not advance.
		const peek = await run(cycleStep, { plan: "plan.md" });
		expect(peek.advanced).toBe(false);
		expect(peek.step).toBe("a");

		expect((await run(cycleStep, { plan: "plan.md", completed: "a" })).step).toBe("b");
		expect((await run(cycleStep, { plan: "plan.md", completed: "b" })).step).toBe("c");

		const end = await run(cycleStep, { plan: "plan.md", completed: "c" });
		expect(end.lapEnd).toBe(true);
		expect(end.advanced).toBe(false);

		const looped = await run(cycleCheckpoint, { plan: "plan.md", decision: "loop", summary: "did a lap" });
		expect(looped.lap).toBe(1);
		expect(looped.step).toBe("a");

		const status = await run(cycleStatus, { plan: "plan.md" });
		expect(status.initialized).toBe(true);
		expect(status.lap).toBe(1);
		expect(status.step).toBe("a");

		const done = await run(cycleCheckpoint, { plan: "plan.md", decision: "done", summary: "solid" });
		expect(done.status).toBe("done");

		await expect(run(cycleStep, { plan: "plan.md", completed: "a" })).rejects.toThrow("reopen");
	});

	it("case-insensitive completed echo advances", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		expect((await run(cycleStep, { plan: "p.md", completed: "A" })).step).toBe("b");
	});

	it("refuses to clobber an active cycle without force", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		await expect(run(cycleStart, { plan: "p.md", cycle: "demo" })).rejects.toThrow("force");
		const forced = await run(cycleStart, { plan: "p.md", cycle: "demo", force: true });
		expect(forced.step).toBe("a");
	});

	it("goto jumps to a step case-insensitively and reopens a finished cycle", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		await run(cycleCheckpoint, { plan: "p.md", decision: "critical-stop", summary: "halt" });
		const goto = await run(cycleGoto, { plan: "p.md", step: "C" });
		expect(goto.step).toBe("c");
		expect(goto.status).toBe("active");
	});

	it("enforces the maxLaps soft cap, then honors acknowledgeOverrun", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "cap" });
		await run(cycleStep, { plan: "p.md", completed: "x" });
		const capped = await run(cycleCheckpoint, { plan: "p.md", decision: "loop", summary: "lap" });
		expect(capped.lapLimitReached).toBe(true);
		expect(capped.lap).toBe(0);
		const ack = await run(cycleCheckpoint, {
			plan: "p.md",
			decision: "loop",
			summary: "lap",
			acknowledgeOverrun: true,
		});
		expect(ack.lap).toBe(1);
	});

	it("goto with resetLap zeroes the lap and convergence signal", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		await run(cycleStep, { plan: "p.md", completed: "a" });
		await run(cycleStep, { plan: "p.md", completed: "b" });
		await run(cycleStep, { plan: "p.md", completed: "c" });
		await run(cycleCheckpoint, { plan: "p.md", decision: "loop", summary: "lap" });
		const reset = await run(cycleGoto, { plan: "p.md", step: "a", resetLap: true });
		expect(reset.lap).toBe(0);
	});

	it("errors when stepping before start", async () => {
		await expect(run(cycleStep, { plan: "missing.md" })).rejects.toThrow("cycleStart first");
	});

	it("returns needsResolution (not a throw) when the current step left the definition", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		const file = path.join(cwd, "p.md");
		fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("current: a", "current: ghost"));
		const stepped = await run(cycleStep, { plan: "p.md", completed: "ghost" });
		expect(stepped.needsResolution).toBe(true);
		expect(stepped.advanced).toBe(false);
		const status = await run(cycleStatus, { plan: "p.md" });
		expect(status.initialized).toBe(true);
		expect(status.error).toContain("no longer");
	});

	it("status reports an error (not a throw) when the definition is gone", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		const file = path.join(cwd, "p.md");
		fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("name: demo", "name: vanished"));
		const status = await run(cycleStatus, { plan: "p.md" });
		expect(status.initialized).toBe(true);
		expect(status.error).toContain("unknown cycle");
	});

	it("guards a malformed cycle block from being clobbered without force", async () => {
		await run(cycleStart, { plan: "p.md", cycle: "demo" });
		const file = path.join(cwd, "p.md");
		fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: active", "status: bogus"));
		const status = await run(cycleStatus, { plan: "p.md" });
		expect(status.initialized).toBe(false);
		expect(status.malformed).toBe(true);
		await expect(run(cycleStart, { plan: "p.md", cycle: "demo" })).rejects.toThrow("malformed");
		expect((await run(cycleStart, { plan: "p.md", cycle: "demo", force: true })).step).toBe("a");
	});

	it("lists available cycle definitions", async () => {
		const list = await run(cycleList, {});
		const names = list.cycles.map((c: { name: string }) => c.name);
		expect(names).toContain("demo");
		expect(names).toContain("cap");
	});
});
