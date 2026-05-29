import fs from "node:fs";
import path from "node:path";

function isWithin(root: string, target: string): boolean {
	const rel = path.relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Resolve a subject-doc path against the MCP client root and refuse anything that escapes it.
// This is the first repo tool to write arbitrary project files, so containment is realpath-based
// (defeats symlinked parent dirs) and a symlinked target file is refused outright.
export function resolvePlanPath(cwd: string, plan: string): string {
	if (!plan || plan.trim() === "") throw new Error("plan path is required");

	const resolved = path.resolve(cwd, plan);
	const realCwd = fs.realpathSync(cwd);

	const parent = path.dirname(resolved);
	if (!fs.existsSync(parent)) {
		throw new Error(`plan directory does not exist: ${path.dirname(plan)}`);
	}
	if (!fs.statSync(parent).isDirectory()) {
		throw new Error(`plan parent is not a directory: ${path.dirname(plan)}`);
	}
	const realParent = fs.realpathSync(parent);
	if (!isWithin(realCwd, realParent)) {
		throw new Error(`plan path escapes the project root: ${plan}`);
	}

	if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
		throw new Error(`refusing to operate on a symlinked plan file: ${plan}`);
	}

	return resolved;
}
