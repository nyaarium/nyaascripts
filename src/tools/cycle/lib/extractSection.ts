// Fence-aware extraction of "## <step>" sections from a markdown body. treeMd's scanner is
// NOT reused here because it matches headers on every line with no code-fence tracking, so a
// "## foo" line inside a fenced block would be mistaken for a real section.

export function normalizeHeader(s: string): string {
	return s
		.trim()
		.replace(/#+\s*$/, "")
		.trim()
		.toLowerCase();
}

function fenceRun(trimmed: string): { char: string; len: number } | null {
	const m = trimmed.match(/^(`{3,}|~{3,})/);
	if (!m) return null;
	return { char: m[1][0], len: m[1].length };
}

// Returns a map of normalized level-2 header -> section body text (the lines under it, up to
// the next level-1 or level-2 header). Throws on duplicate step headers.
export function extractSections(body: string): Map<string, string> {
	const lines = body.split(/\r?\n/);
	const sections = new Map<string, string>();

	let inFence = false;
	let fenceChar = "";
	let fenceLen = 0;

	let currentKey: string | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (currentKey !== null) {
			sections.set(currentKey, buffer.join("\n").trim());
		}
		buffer = [];
	};

	for (const line of lines) {
		const trimmed = line.trim();
		const fence = fenceRun(trimmed);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceChar = fence.char;
				fenceLen = fence.len;
			} else if (fence.char === fenceChar && fence.len >= fenceLen) {
				inFence = false;
			}
			if (currentKey !== null) buffer.push(line);
			continue;
		}

		const header = !inFence ? line.match(/^(#{1,2})\s+(.+)$/) : null;
		if (header) {
			const level = header[1].length;
			if (level <= 2) {
				flush();
				if (level === 2) {
					const key = normalizeHeader(header[2]);
					if (sections.has(key)) {
						throw new Error(`duplicate step section: "${key}"`);
					}
					currentKey = key;
				} else {
					currentKey = null; // level-1 header closes any open step section
				}
				continue;
			}
		}

		if (currentKey !== null) buffer.push(line);
	}
	if (inFence) {
		throw new Error("unterminated code fence in markdown body");
	}
	flush();
	return sections;
}

export function extractSection(body: string, step: string): string {
	const sections = extractSections(body);
	const text = sections.get(normalizeHeader(step));
	if (text === undefined) {
		throw new Error(`missing "## ${step}" section`);
	}
	return text;
}
