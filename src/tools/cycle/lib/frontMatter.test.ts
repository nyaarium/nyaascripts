import { describe, expect, it } from "bun:test";
import { locateFrontMatter, parseFrontMatter, parseFrontMatterFields, upsertTopLevelBlock } from "./frontMatter.ts";

function cycleField(content: string, key: string): unknown {
	return (parseFrontMatter(content).fields.cycle as Record<string, unknown>)[key];
}

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

describe("upsertTopLevelBlock", () => {
	const value = { name: "x", current: "audit", index: 1 };

	it("creates front matter when absent and preserves the body", () => {
		const out = upsertTopLevelBlock("# Plan\nbody\n", "cycle", value);
		expect(out.startsWith("---\ncycle:\n")).toBe(true);
		expect(out.endsWith("# Plan\nbody\n")).toBe(true);
	});
	it("inserts into existing front matter, keeps other keys and body", () => {
		const c = "---\ntitle: T\n---\n# Body\nverbatim\n";
		const out = upsertTopLevelBlock(c, "cycle", value);
		expect(out).toContain("title: T");
		expect(out).toContain("cycle:");
		expect(out.endsWith("# Body\nverbatim\n")).toBe(true);
	});
	it("replaces an existing cycle block, keeps siblings", () => {
		const c = "---\ncycle:\n  name: old\n  index: 9\nother: y\n---\nbody\n";
		const out = upsertTopLevelBlock(c, "cycle", value);
		expect(out).toContain("other: y");
		expect(out).not.toContain("index: 9");
		expect(out).toContain("index: 1");
	});
	it("never emits tab indentation", () => {
		expect(upsertTopLevelBlock("body\n", "cycle", value).includes("\t")).toBe(false);
	});
	it("converges: repeated upserts do not grow blank lines", () => {
		let c = "---\ntitle: T\n---\nbody\n";
		c = upsertTopLevelBlock(c, "cycle", { name: "x", lap: 1 });
		const twice = upsertTopLevelBlock(c, "cycle", { name: "x", lap: 2 });
		const thrice = upsertTopLevelBlock(twice, "cycle", { name: "x", lap: 2 });
		expect(thrice).toBe(twice);
		expect(thrice).not.toContain("\n\n\n");
	});
	it("keeps a CRLF document all-CRLF (no mixed endings)", () => {
		const c = "---\r\ntitle: T\r\n---\r\nbody\r\n";
		const out = upsertTopLevelBlock(c, "cycle", value);
		const stripped = out.replace(/\r\n/g, "");
		expect(stripped.includes("\n")).toBe(false);
		expect(out.endsWith("body\r\n")).toBe(true);
	});
	it("quotes a number-like value so it round-trips as a string", () => {
		const out = upsertTopLevelBlock("body\n", "cycle", { current: "8" });
		expect(out).toContain('current: "8"');
		expect(cycleField(out, "current")).toBe("8");
	});
	it("escapes a newline so a value cannot break the front matter, and round-trips it", () => {
		const out = upsertTopLevelBlock("BODY\n", "cycle", { summary: "line1\nline2" });
		expect(out).toContain('summary: "line1\\nline2"');
		const parsed = parseFrontMatter(out);
		expect(parsed.body).toBe("BODY\n");
		expect((parsed.fields.cycle as Record<string, unknown>).summary).toBe("line1\nline2");
	});
	it("a value containing --- cannot terminate the front matter boundary", () => {
		const out = upsertTopLevelBlock("BODY\n", "cycle", { reason: "a\n---\nb" });
		const parsed = parseFrontMatter(out);
		expect(parsed.body).toBe("BODY\n");
		expect((parsed.fields.cycle as Record<string, unknown>).reason).toBe("a\n---\nb");
	});
	it("uses the front matter EOL, not a stray CRLF in the body", () => {
		const c = "---\ntitle: T\n---\nplain\r\nmore\n";
		const out = upsertTopLevelBlock(c, "cycle", { name: "x" });
		expect(out).toContain("\ncycle:\n  name: x\n");
		expect(out.endsWith("plain\r\nmore\n")).toBe(true);
	});
	it("replaces a block even when a blank line splits it, dropping stale subkeys", () => {
		const c = "---\ncycle:\n  name: old\n\n  index: 9\nother: y\n---\nbody\n";
		const out = upsertTopLevelBlock(c, "cycle", { name: "new" });
		expect(out).toContain("other: y");
		expect(out).not.toContain("index: 9");
		expect(out).toContain("name: new");
	});
	it("quotes a YAML-ambiguous word like yes", () => {
		expect(upsertTopLevelBlock("b\n", "cycle", { current: "yes" })).toContain('current: "yes"');
	});
	it("ignores a grandchild of an unmodeled nested map instead of flattening it", () => {
		const fm = "cycle:\n  name: x\n  meta:\n    a: 1\n  status: active\n";
		expect(parseFrontMatterFields(fm)).toEqual({ cycle: { name: "x", meta: null, status: "active" } });
	});
	it("treats an unterminated [ as a scalar, not a mis-parsed list", () => {
		expect(parseFrontMatterFields("steps: [a, b")).toEqual({ steps: "[a, b" });
	});
	it("parses a flow list with a trailing comment", () => {
		expect(parseFrontMatterFields("steps: [a, b] # note")).toEqual({ steps: ["a", "b"] });
	});
	it("keeps a leading-dot decimal string as a string (no number drift)", () => {
		const out = upsertTopLevelBlock("b\n", "cycle", { current: ".5" });
		expect(out).toContain('current: ".5"');
		expect(cycleField(out, "current")).toBe(".5");
		expect(parseFrontMatterFields("v: .5")).toEqual({ v: ".5" });
	});
});
