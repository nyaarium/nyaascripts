import { z } from "zod";

export const repoPathParam = z
	.string()
	.optional()
	.describe(
		`
Absolute file path to the git repository.

Omit to use the current project.
`.trim(),
	);
