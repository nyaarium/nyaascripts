# nyaascripts

Personal MCP (Model Context Protocol) server and CLI toolkit. Provides GitHub, Cursor, Gmail, and utility tools for AI agents, plus interactive CLI wrappers and standalone shell scripts.

## Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.3.11+
- [GitHub CLI](https://cli.github.com/) (`gh`) - authenticated via `gh auth login`

### Install

```sh
# Clone and install
bun install

# Build the compiled binary
bun run build    # outputs ./nyaascripts

# Add scripts to PATH
export PATH="$HOME/scripts:$PATH"  # add to .bashrc
```

### Environment

Create a `.env` file in the project root:

```sh
CURSOR_AGENT_KEY=xxxxxxxx
OPENROUTER_KEY=xxxxxxxx
OPENAI_KEY=xxxxxxxx
TINYPNG_KEY=xxxxxxxx

DISCORD_CLIENT_ID=xxxxxxxx
DISCORD_SECRET_KEY=xxxxxxxx
DISCORD_INVITE_URL=xxxxxxxx

# https://console.cloud.google.com/auth/clients
GOOGLE_CLIENT_ID=xxxxxxxx
GOOGLE_CLIENT_SECRET=xxxxxxxx
```

### GitHub CLI

```sh
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list

apt update && apt install -y gh

# As user:
gh auth login --with-token
```

## Architecture

```
src/
  entry.ts              # MCP server entrypoint (stdio transport)
  cli/                  # Interactive CLI wrappers
  tools/
    toolsTreeMd.ts      # Directory tree renderer
    github/             # GitHub tools (gh CLI)
      index.ts          # Tool registry (17 tools)
      lib/              # Shared: runGh, checkGHCLI, schemas
      tools/            # Individual tool modules + tests
    cursorAgent/        # Cursor IDE agent tools (10 tools)
      index.ts          # Tool registry
      lib/              # Shared: makeRequest, schemas
      tools/            # Individual tool modules
    google/             # Google tools
      index.ts          # Tool registry (2 tools)
      lib/              # OAuth auth helpers
      gmail.ts          # Gmail search + fetch
```

### Tool Pattern

Every tool exports `{ name, title, description, schema, handler }`:

- **schema**: Zod object defining input parameters
- **handler(cwd, args)**: Async function returning `{ data }` result
- **Pure functions**: Exported for unit testing (e.g., `transformRuns`, `buildCreateArgs`)
- **dryRun**: Mutable tools support `dryRun` parameter. Only `dryRun: true` appears in responses when active; omitted from non-dry-run responses

## MCP Tools

### Git (9 tools)

Local git tools that operate on the repository at the MCP client root.

| Tool | Description | Mutable | dryRun |
|------|-------------|---------|--------|
| `gitLog` | Git log with parsed commits | No | - |
| `gitStatus` | Working tree status (branch, staged, unstaged, untracked) | No | - |
| `gitStage` | Stage files for commit | Yes | Yes |
| `gitCommit` | Create a commit from staged changes | Yes | Yes |
| `gitFetch` | Fetch from remote and prune deleted refs | No | - |
| `gitPull` | Pull changes from remote | No | - |
| `gitPushNewBranch` | Move commits to new branch, optionally create PR | Yes | Yes |
| `gitCleanupBranches` | Delete merged branches | Yes | Yes |
| `gitSummarizeActivity` | Summarize recent repo activity | No | - |

### GitHub (13 tools)

All GitHub tools use the `gh` CLI under the hood.

| Tool | Description | Mutable | dryRun |
|------|-------------|---------|--------|
| `githubFetchCommit` | Fetch commit details | No | - |
| `githubFetchPr` | Fetch PR details | No | - |
| `githubListPr` | List pull requests | No | - |
| `githubFetchIssue` | Fetch issue details | No | - |
| `githubFetchWorkflowRuns` | List workflow runs by branch | No | - |
| `githubFetchWorkflowRun` | Single run details with jobs/steps/logs | No | - |
| `githubAwaitWorkflowRun` | Poll a run until completion or timeout | No | - |
| `githubPrComment` | Post a comment on a PR | Yes | Yes |
| `githubApprovePr` | Approve and optionally merge PRs | Yes | Yes |
| `githubApproveDependabot` | Approve Dependabot PRs | Yes | Yes |
| `githubRerunWorkflow` | Re-run a workflow (all or failed only) | Yes | Yes |
| `githubCreateIssue` | Create a new issue | Yes | Yes |
| `githubUpdateIssue` | Update issue state/title/body/labels/assignees | Yes | Yes |

### Cursor Agent (10 tools)

Remote control for Cursor IDE agents via API.

| Tool | Description |
|------|-------------|
| `cursorLaunchAgent` | Launch a new Cursor agent |
| `cursorGetAgentStatus` | Check agent status |
| `cursorListAgents` | List all agents |
| `cursorAddFollowUp` | Send follow-up message to agent |
| `cursorDeleteAgent` | Delete an agent |
| `cursorGetAgentConversation` | Get agent conversation history |
| `cursorListModels` | List available models |
| `cursorListRepositories` | List repositories |
| `cursorWaitUntilDone` | Wait for agent to complete |
| `cursorMergePullRequest` | Merge a PR via Cursor |

### Google (2 tools)

| Tool | Description |
|------|-------------|
| `gmailSearch` | Search Gmail messages |
| `gmailFetchMessages` | Fetch full message content |

### Utility (1 tool)

| Tool | Description |
|------|-------------|
| `treeMd` | Generate markdown directory tree |

## CLI Wrappers

Interactive CLI scripts that wrap MCP tools for terminal use. Located in `src/cli/`, invoked via thin shell launchers in the project root.

| Script | CLI Wrapper | Description |
|--------|-------------|-------------|
| `approve-dependabot` | `src/cli/approveDependabot.ts` | Interactively approve Dependabot PRs |
| `cleanup-branches` | `src/cli/cleanupBranches.ts` | Interactively clean up merged branches |
| `push-new-branch` | `src/cli/pushNewBranch.ts` | Create branch, push, open PR with prompts |
| `summarize-activity` | `src/cli/summarizeActivity.ts` | Summarize recent GitHub activity |
| `tree-md` | `src/cli/treeMd.ts` | Print directory tree to terminal |

## Standalone Shell Scripts

Scripts that remain as standalone bash (not ported to MCP tools).

| Script | Description |
|--------|-------------|
| `rebase-branch` | Interactive rebase onto main/master |
| `reset-repo` | Hard reset repo to remote HEAD |
| `make-service` | Create a systemd service for a command |
| `start-vllm` | Launch vLLM inference server |
| `sync-dir` | Rsync-based directory sync |
| `devcontainer.sh` | Build/start/attach to devcontainer |
| `devcontainer-up.sh` | Start devcontainer (headless) |
| `devcontainer-down.sh` | Stop devcontainer |

## Development

```sh
bun run lint        # biome ci + typecheck
bun run lint:fix    # biome auto-fix
bun run test        # bun test (145 tests across 13 files)
bun run build       # compile to ./nyaascripts binary
bun run typecheck   # tsc --noEmit
```

### Code Style

Enforced by [Biome](https://biomejs.dev/) v2.4.8:

- Tabs, double quotes, semicolons, trailing commas
- 120 character line width
- `import type` enforced (`useImportType: error`)
- `noExplicitAny: error`
- Organize imports on save

### Testing

Tests use `bun:test`. Test files live alongside their source files (`*.test.ts`). Tests cover:

- Pure transform functions (input/output validation)
- Zod schema validation (required fields, defaults, enum values)
- Argument builders for CLI commands

### Adding a New Tool

1. Create `src/tools/github/tools/myNewTool.ts` exporting `{ name, title, description, schema, handler }`
2. Export pure functions for testability
3. Add `dryRun` to schema if the tool mutates state
4. Register in `src/tools/github/index.ts`
5. Add tests in `myNewTool.test.ts`
