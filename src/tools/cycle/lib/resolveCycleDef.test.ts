import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listCycleDefs, loadCycleDef } from "./resolveCycleDef.ts";

let dir: string;
const prev = process.env.NYAASCRIPTS_CYCLES_DIR;

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "cycles-"));
	process.env.NYAASCRIPTS_CYCLES_DIR = dir;
	fs.writeFileSync(path.join(dir, "good.md"), "---\nsteps: [a, b]\nmaxLaps: 3\n---\n## a\nAA\n## b\nBB\n");
	fs.writeFileSync(path.join(dir, "dup.md"), "---\nsteps: [a, a]\n---\n## a\nx\n");
	fs.writeFileSync(path.join(dir, "missing.md"), "---\nsteps: [a, b]\n---\n## a\nx\n");
	fs.mkdirSync(path.join(dir, "dir.md"));
	fs.symlinkSync(path.join(dir, "good.md"), path.join(dir, "linked.md"));
});

afterAll(() => {
	if (prev === undefined) delete process.env.NYAASCRIPTS_CYCLES_DIR;
	else process.env.NYAASCRIPTS_CYCLES_DIR = prev;
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadCycleDef", () => {
	it("loads and validates a good definition", () => {
		const d = loadCycleDef("good");
		expect(d.steps).toEqual(["a", "b"]);
		expect(d.maxLaps).toBe(3);
	});
	it("falls back to the default for a non-integer maxLaps", () => {
		fs.writeFileSync(path.join(dir, "frac.md"), "---\nsteps: [a]\nmaxLaps: 2.5\n---\n## a\nx\n");
		expect(loadCycleDef("frac").maxLaps).toBe(8);
	});
	it("lists available definitions", () => {
		expect(listCycleDefs()).toContain("good");
	});
	it("throws on an unknown cycle", () => {
		expect(() => loadCycleDef("nope")).toThrow("unknown cycle");
	});
	it("throws on duplicate steps", () => {
		expect(() => loadCycleDef("dup")).toThrow("duplicate step");
	});
	it("throws when a step has no section", () => {
		expect(() => loadCycleDef("missing")).toThrow("missing");
	});
	it("rejects an unsafe name", () => {
		expect(() => loadCycleDef("../etc")).toThrow("invalid cycle name");
	});
	it("does not list a directory named *.md", () => {
		expect(listCycleDefs()).not.toContain("dir");
	});
	it("refuses a symlinked definition file", () => {
		expect(() => loadCycleDef("linked")).toThrow("symlinked");
	});
});
