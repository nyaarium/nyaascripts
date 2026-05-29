import { describe, expect, it } from "bun:test";
import { extractSection, extractSections, normalizeHeader } from "./extractSection.ts";

const body = [
	"# Plan X",
	"",
	"## propose",
	"do propose",
	"",
	"## audit",
	"run audit",
	"```md",
	"## not-a-header",
	"```",
	"still audit",
	"",
	"## triage",
	"triage text",
	"",
].join("\n");

describe("extractSections", () => {
	it("extracts level-2 sections in order", () => {
		expect([...extractSections(body).keys()]).toEqual(["propose", "audit", "triage"]);
	});
	it("does not treat a fenced ## line as a section boundary", () => {
		const s = extractSections(body);
		expect([...s.keys()]).not.toContain("not-a-header");
		expect(s.get("audit")).toContain("## not-a-header");
		expect(s.get("audit")).toContain("still audit");
	});
	it("throws on duplicate step headers", () => {
		expect(() => extractSections("## a\nx\n## a\ny\n")).toThrow("duplicate");
	});
	it("throws on an unterminated code fence", () => {
		expect(() => extractSections("## a\n```\nnever closed\n")).toThrow("unterminated");
	});
	it("extracts sections from a CRLF body", () => {
		expect([...extractSections("## a\r\nAA\r\n## b\r\nBB\r\n").keys()]).toEqual(["a", "b"]);
	});
});

describe("extractSection", () => {
	it("throws when the section is missing", () => {
		expect(() => extractSection("## a\nx\n", "b")).toThrow("missing");
	});
	it("matches case-insensitively and ignores trailing #", () => {
		expect(normalizeHeader("  Audit ## ")).toBe("audit");
		expect(extractSection("## Audit\nhi\n", "audit")).toBe("hi");
	});
});
