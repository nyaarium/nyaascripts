import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface AtomicWriteOptions {
	// When set, the on-disk file must still have this mtime at write time, else the write is
	// refused. Best-effort optimistic-concurrency check for a cooperating writer: on filesystems
	// with coarse mtime resolution two writes in the same tick can share an mtime and slip past.
	expectedMtimeMs?: number;
}

// Read a file and capture its mtime in one shot, so a caller can later guard the write.
export function readWithMtime(filePath: string): { content: string; mtimeMs: number } {
	const content = fs.readFileSync(filePath, "utf8");
	return { content, mtimeMs: fs.statSync(filePath).mtimeMs };
}

// Write via a temp file + rename so a crash mid-write never leaves a truncated plan file.
// The temp name carries pid + random bytes so two concurrent writes to the same file never
// collide on the temp path.
export function writeFileAtomic(filePath: string, content: string, opts: AtomicWriteOptions = {}): void {
	if (opts.expectedMtimeMs !== undefined && fs.existsSync(filePath)) {
		const current = fs.statSync(filePath).mtimeMs;
		if (current !== opts.expectedMtimeMs) {
			throw new Error("plan file changed on disk since it was read; re-read and retry");
		}
	}
	const dir = path.dirname(filePath);
	const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
	// "wx" (O_EXCL) refuses to open if the temp path already exists, so a symlink planted at the
	// predictable temp path cannot be followed and written through.
	fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "wx" });
	fs.renameSync(tmp, filePath);
}
