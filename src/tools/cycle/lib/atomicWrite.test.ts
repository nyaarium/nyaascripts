import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWithMtime, writeFileAtomic } from "./atomicWrite.ts";

let dir: string;

beforeAll(() => {
	dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "atomic-")));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
	it("writes content and leaves no temp file behind", () => {
		const f = path.join(dir, "a.md");
		writeFileAtomic(f, "hello");
		expect(fs.readFileSync(f, "utf8")).toBe("hello");
		expect(fs.readdirSync(dir).some((n) => n.includes(".tmp-"))).toBe(false);
	});
	it("refuses when mtime changed since read", () => {
		const f = path.join(dir, "b.md");
		writeFileAtomic(f, "v1");
		const { mtimeMs } = readWithMtime(f);
		// Simulate an external change with a deterministically different mtime.
		const bumped = new Date(mtimeMs + 5000);
		fs.utimesSync(f, bumped, bumped);
		expect(() => writeFileAtomic(f, "v3", { expectedMtimeMs: mtimeMs })).toThrow("changed on disk");
	});
	it("allows write when mtime matches", () => {
		const f = path.join(dir, "c.md");
		writeFileAtomic(f, "v1");
		const { mtimeMs } = readWithMtime(f);
		writeFileAtomic(f, "v2", { expectedMtimeMs: mtimeMs });
		expect(fs.readFileSync(f, "utf8")).toBe("v2");
	});
});
