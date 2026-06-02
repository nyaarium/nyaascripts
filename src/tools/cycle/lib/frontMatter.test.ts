import { describe, expect, it } from "bun:test";
import { locateFrontMatter, parseFrontMatterFields } from "./frontMatter.ts";

describe("parseFrontMatterFields", () => {
	it("parses a flow list", () => {
		expect(parseFrontMatterFields("steps: [a, b, c]")).toEqual({ steps: ["a", "b", "c"] });
	});
	it("keeps a quoted comma inside a flow element", () => {
		expect(parseFrontMatterFields('steps: ["a,b", c]')).toEqual({ steps: ["a,b", "c"] });
	});
	it("parses a block list", () => {
		expect(parseFrontMatterFields("steps:\n  - a\n  - b\n")).toEqual({ steps: ["a", "b"] });
	});
	it("parses a one-level nested map", () => {
		const fm = "cycle:\n  name: x\n  index: 1\n  status: active\n";
		expect(parseFrontMatterFields(fm)).toEqual({ cycle: { name: "x", index: 1, status: "active" } });
	});
	it("parses scalars, skips comments, unquotes", () => {
		const fm = 'maxLaps: 8\n# comment line\nname: "hello world"\n';
		expect(parseFrontMatterFields(fm)).toEqual({ maxLaps: 8, name: "hello world" });
	});
	it("strips trailing inline comment on unquoted values", () => {
		expect(parseFrontMatterFields("name: foo # note")).toEqual({ name: "foo" });
	});
});

describe("locateFrontMatter", () => {
	it("returns null without a leading ---", () => {
		expect(locateFrontMatter("# title\nbody")).toBeNull();
	});
	it("returns null when the closing --- is missing (fail closed)", () => {
		expect(locateFrontMatter("---\nsteps: [a]\nbody")).toBeNull();
	});
	it("locates the span and body", () => {
		const c = "---\nsteps: [a]\n---\nbody\n";
		const loc = locateFrontMatter(c);
		if (!loc) throw new Error("expected a location");
		expect(c.slice(loc.fmStart, loc.fmEnd)).toBe("steps: [a]\n");
		expect(c.slice(loc.bodyStart)).toBe("body\n");
	});
	it("handles BOM and CRLF", () => {
		const c = "\uFEFF---\r\nsteps: [a]\r\n---\r\nbody\r\n";
		const loc = locateFrontMatter(c);
		if (!loc) throw new Error("expected a location");
		expect(loc.bom).toBe(true);
		expect(loc.eol).toBe("\r\n");
		expect(c.slice(loc.bodyStart)).toBe("body\r\n");
	});
});
