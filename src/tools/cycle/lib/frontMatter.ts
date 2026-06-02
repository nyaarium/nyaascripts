// Hand-rolled, fail-closed, read-only front matter parsing for cycle definition files (steps,
// maxLaps). No YAML dep on purpose; we only read a narrow modeled subset.

export type Eol = "\n" | "\r\n";

export interface FrontMatterLocation {
	bom: boolean;
	eol: Eol;
	// Offsets into the original content string.
	openStart: number; // start of opening "---" line (after any BOM)
	fmStart: number; // first char of front matter body (after opening "---" + eol)
	fmEnd: number; // start of the closing "---" line
	bodyStart: number; // first char of the document body (after closing "---" + eol)
}

export function hasBom(content: string): boolean {
	return content.charCodeAt(0) === 0xfeff;
}

// Locate the front matter span. Opening "---" must be the first line (after an optional BOM);
// the closing "---" is the first later line that is exactly "---". Returns null when absent.
export function locateFrontMatter(content: string): FrontMatterLocation | null {
	const bom = hasBom(content);
	const start = bom ? 1 : 0;

	const firstLineEnd = content.indexOf("\n", start);
	if (firstLineEnd === -1) return null;
	const eol: Eol = content[firstLineEnd - 1] === "\r" ? "\r\n" : "\n";
	const firstLine = content.slice(start, firstLineEnd).replace(/\r$/, "");
	if (firstLine !== "---") return null;

	const fmStart = firstLineEnd + 1;
	const lines = content.slice(fmStart).split("\n");
	let cursor = fmStart;
	for (const line of lines) {
		if (line.replace(/\r$/, "") === "---") {
			return { bom, eol, openStart: start, fmStart, fmEnd: cursor, bodyStart: cursor + line.length + 1 };
		}
		cursor += line.length + 1;
	}
	// Opening "---" with no closing "---": malformed, treat as no front matter (fail closed).
	return null;
}

export type Scalar = string | number | boolean | null;

function unescapeDoubleQuoted(inner: string): string {
	return inner.replace(/\\(["\\nrt])/g, (_m, c) => {
		if (c === "n") return "\n";
		if (c === "r") return "\r";
		if (c === "t") return "\t";
		return c; // " or \
	});
}

function parseScalar(raw: string): Scalar {
	let v = raw.trim();
	if (v === "") return null;
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
		return unescapeDoubleQuoted(v.slice(1, -1));
	}
	if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
		return v.slice(1, -1);
	}
	// Strip a trailing inline comment only on unquoted values.
	const hash = v.indexOf(" #");
	if (hash !== -1) v = v.slice(0, hash).trim();
	if (v === "true") return true;
	if (v === "false") return false;
	if (v === "null") return null;
	if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
	// Require a leading digit so ".5" stays a string, matching what serializeScalar will/won't quote.
	if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
	return v;
}

// Split on commas that are not inside quotes, so a quoted element containing a comma stays whole.
function splitFlow(inner: string): string[] {
	const parts: string[] = [];
	let buf = "";
	let quote = "";
	let escaped = false;
	for (const ch of inner) {
		if (escaped) {
			buf += ch;
			escaped = false;
		} else if (quote === '"' && ch === "\\") {
			buf += ch;
			escaped = true;
		} else if (quote) {
			buf += ch;
			if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") {
			quote += ch;
			buf += ch;
		} else if (ch === ",") {
			parts.push(buf);
			buf = "";
		} else {
			buf += ch;
		}
	}
	parts.push(buf);
	return parts;
}

function parseFlowList(raw: string): Scalar[] {
	const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
	if (inner.trim() === "") return [];
	return splitFlow(inner)
		.map((s) => parseScalar(s))
		.filter((s) => s !== null && s !== "");
}

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

// Parse the narrow subset we model: top-level scalars, flow lists ([a, b]), block lists
// (- item), and one level of nested map (key:\n  child: v). Lines we do not model are
// ignored here; structural validation is the caller's job.
export function parseFrontMatterFields(fmText: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const lines = fmText.split("\n").map((l) => l.replace(/\r$/, ""));

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#") || indentOf(line) !== 0) {
			i++;
			continue;
		}
		const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
		if (!m) {
			i++;
			continue;
		}
		const key = m[1];
		const rest = m[2].trim();

		// A flow list needs a closing "]"; parse up to it and ignore a trailing comment. An
		// unterminated "[" has no "]" and falls through to scalar, so malformed list syntax fails
		// closed downstream rather than mis-reading into a clean list.
		if (rest.startsWith("[")) {
			const close = rest.lastIndexOf("]");
			if (close !== -1) {
				out[key] = parseFlowList(rest.slice(0, close + 1));
				i++;
				continue;
			}
		}
		if (rest !== "") {
			out[key] = parseScalar(rest);
			i++;
			continue;
		}

		// Empty value: look ahead for a block list or nested map.
		const listItems: Scalar[] = [];
		const mapObj: Record<string, Scalar> = {};
		let sawList = false;
		let sawMap = false;
		let childIndent = -1;
		let j = i + 1;
		while (j < lines.length) {
			const child = lines[j];
			const ct = child.trim();
			if (ct === "" || ct.startsWith("#")) {
				j++;
				continue;
			}
			const ind = indentOf(child);
			if (ind === 0) break;
			if (childIndent === -1) childIndent = ind;
			// Only direct children at the first-child indent are modeled; deeper lines (a
			// grandchild of an unmodeled nested map) are ignored, never flattened into the parent.
			if (ind !== childIndent) {
				j++;
				continue;
			}
			if (ct.startsWith("- ")) {
				sawList = true;
				listItems.push(parseScalar(ct.slice(2)));
			} else {
				const cm = ct.match(/^([A-Za-z0-9_-]+):(.*)$/);
				if (cm) {
					sawMap = true;
					mapObj[cm[1]] = parseScalar(cm[2]);
				}
			}
			j++;
		}
		if (sawList) out[key] = listItems;
		else if (sawMap) out[key] = mapObj;
		else out[key] = null;
		i = j;
	}
	return out;
}

export interface ParsedFrontMatter {
	location: FrontMatterLocation | null;
	fields: Record<string, unknown>;
	body: string;
}

export function parseFrontMatter(content: string): ParsedFrontMatter {
	const location = locateFrontMatter(content);
	if (!location) return { location: null, fields: {}, body: content };
	const fmText = content.slice(location.fmStart, location.fmEnd);
	return {
		location,
		fields: parseFrontMatterFields(fmText),
		body: content.slice(location.bodyStart),
	};
}
