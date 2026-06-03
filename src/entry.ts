import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import type { z } from "zod";
import { toolsGit } from "./tools/git/index.ts";
import { toolsGitHub } from "./tools/github/index.ts";
import { toolsGoogle } from "./tools/google/index.ts";
import { toolsTreeMd } from "./tools/toolsTreeMd.ts";

export interface McpTool {
	name: string;
	title: string;
	description: string;
	operation?: string;
	schema: z.ZodObject<z.ZodRawShape>;
	handler: (cwd: string, args: Record<string, unknown>) => Promise<unknown>;
}

const scriptDir = path.dirname(process.execPath);

process.chdir(scriptDir);

process.env.DOTENV_CONFIG_QUIET = "true";
dotenv.config({ path: path.join(scriptDir, ".env") });

const mcpServer = new McpServer({
	name: "nyaascripts",
	version: "1.2.1",
});

function registerTool(tool: McpTool) {
	mcpServer.registerTool(
		tool.name,
		{
			title: tool.title,
			description: tool.description,
			inputSchema: tool.schema.shape,
		},
		async (args) => {
			try {
				let cwd: string;
				try {
					const roots = (await mcpServer.server.listRoots()) as { roots: Array<{ uri: string }> };
					if (!roots.roots || roots.roots.length === 0) throw new Error("listRoots: no roots");
					cwd = fileURLToPath(roots.roots[0].uri);
				} catch {
					cwd = process.cwd();
				}
				const result = await tool.handler(cwd, args);
				return {
					content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ errors: [{ message: (error as Error).message }] }, null, 2),
						},
					],
					isError: true,
				};
			}
		},
	);
}

for (const tool of [...toolsTreeMd, ...toolsGit, ...toolsGitHub, ...toolsGoogle]) {
	registerTool(tool as McpTool);
}

async function main() {
	const transport = new StdioServerTransport();
	await mcpServer.connect(transport);
}

main().catch((error) => {
	console.error("Server error:", error);
	process.exit(1);
});
