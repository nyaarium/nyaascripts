import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePlanPath } from "./resolvePlanPath.ts";

let root: string;

beforeAll(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "plan-")));
	fs.mkdirSync(path.join(root, "plans"));
	fs.writeFileSync(path.join(root, "plans", "p.md"), "x");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("resolvePlanPath", () => {
	it("resolves a path within the root", () => {
		expect(resolvePlanPath(root, "plans/p.md")).toBe(path.join(root, "plans", "p.md"));
	});
	it("allows a new file in an existing directory", () => {
		expect(resolvePlanPath(root, "plans/new.md")).toBe(path.join(root, "plans", "new.md"));
	});
	it("rejects traversal outside the root", () => {
		expect(() => resolvePlanPath(root, "../escape.md")).toThrow("escapes");
	});
	it("rejects a missing parent directory", () => {
		expect(() => resolvePlanPath(root, "nope/x.md")).toThrow("does not exist");
	});
	it("refuses a symlinked target", () => {
		const target = path.join(root, "outside.md");
		fs.writeFileSync(target, "y");
		fs.symlinkSync(target, path.join(root, "plans", "link.md"));
		expect(() => resolvePlanPath(root, "plans/link.md")).toThrow("symlink");
	});
	it("requires a plan path", () => {
		expect(() => resolvePlanPath(root, "")).toThrow("required");
	});
});
