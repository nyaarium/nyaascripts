// Hand-rolled, fail-closed front matter handling. No YAML dep on purpose: a full
// parse/serialize round-trip reformats and strips comments, which would clobber the
// subject doc. We only ever read a narrow subset and surgically rewrite one top-level block.

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

// Dominant EOL of the whole document, so a single stray CRLF in an otherwise-LF body does not
// flip the result. Used only when creating front matter from scratch.
export function detectEol(content: string): Eol {
	const crlf = (content.match(/\r\n/g) ?? []).length;
	const lf = (content.match(/\n/g) ?? []).length - crlf;
	return crlf > lf ? "\r\n" : "\n";
}

// Locate the front matter span. Opening "---" must be the first line (after an optional BOM);
// the closing "---" is the first later line that is exactly "---". Returns null when absent.
// eol is taken from the opening line's own terminator (the front matter's EOL), so a rewrite
// of the block always matches the block it is replacing, regardless of the body's line endings.
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

function escapeDoubleQuoted(v: string): string {
	return v
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
}

function serializeScalar(v: Scalar): string {
	if (v === null) return "null";
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	// Always quote (and escape) when the value contains a line break or structural/ambiguous
	// content, so it can never break the front-matter block boundary or re-parse as another type.
	const hasControl = /[\n\r\t]/.test(v);
	const ambiguous =
		/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v) ||
		/^0x[0-9a-fA-F]+$/.test(v) ||
		/^(true|false|null|yes|no|on|off|~)$/i.test(v);
	const structural = v === "" || /[:#]/.test(v) || v !== v.trim() || /^[[{!&*?|>%@`"']/.test(v);
	return hasControl || ambiguous || structural ? `"${escapeDoubleQuoted(v)}"` : v;
}

function keyLineMatches(line: string, key: string): boolean {
	return line === `${key}:` || line.startsWith(`${key}: `);
}

// Render a one-level map as a top-level key block, two-space indented (YAML forbids tab
// indentation, so never emit tabs here regardless of repo style).
function renderMapBlock(key: string, obj: Record<string, Scalar>, eol: Eol): string {
	const lines = [`${key}:`];
	for (const [k, v] of Object.entries(obj)) {
		lines.push(`  ${k}: ${serializeScalar(v)}`);
	}
	return lines.join(eol);
}

// Surgically replace (or insert) a single top-level key whose value is a one-level map, inside
// the front matter. This function OWNS rendering: callers pass data, not text, so the document's
// own EOL is always used and a caller cannot introduce a mismatched line ending. The body is
// preserved byte-for-byte; BOM and dominant EOL are preserved; trailing blank lines never grow.
export function upsertTopLevelBlock(content: string, key: string, value: Record<string, Scalar>): string {
	const location = locateFrontMatter(content);
	// Use the front matter's own EOL when it exists, so the rewritten block matches the block it
	// replaces even if the body uses different line endings. Only fall back to the document's
	// dominant EOL when creating front matter from scratch.
	const eol: Eol = location ? location.eol : detectEol(content);
	const blockLines = renderMapBlock(key, value, eol).split(eol);

	if (!location) {
		const bom = hasBom(content) ? "\uFEFF" : "";
		const rest = hasBom(content) ? content.slice(1) : content;
		return `${bom}---${eol}${blockLines.join(eol)}${eol}---${eol}${rest}`;
	}

	const fmText = content.slice(location.fmStart, location.fmEnd);
	const lines = fmText.split(/\r?\n/);
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (keyLineMatches(lines[i], key)) {
			startIdx = i;
			break;
		}
	}

	if (startIdx === -1) {
		lines.push(...blockLines);
	} else {
		// Consume the whole block: indented continuation lines, and blank lines that are
		// themselves followed by more indented lines. Stop at a blank that precedes the next
		// top-level key, so a separator before an unrelated key is preserved.
		let endIdx = startIdx + 1;
		while (endIdx < lines.length) {
			if (indentOf(lines[endIdx]) > 0) {
				endIdx++;
				continue;
			}
			if (lines[endIdx].trim() === "") {
				let k = endIdx + 1;
				while (k < lines.length && lines[k].trim() === "") k++;
				if (k < lines.length && indentOf(lines[k]) > 0) {
					endIdx = k;
					continue;
				}
			}
			break;
		}
		lines.splice(startIdx, endIdx - startIdx, ...blockLines);
	}

	const newFm = `${lines.join(eol)}${eol}`;
	return content.slice(0, location.fmStart) + newFm + content.slice(location.fmEnd);
}
