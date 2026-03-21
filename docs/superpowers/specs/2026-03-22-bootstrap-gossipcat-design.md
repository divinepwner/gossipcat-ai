# Bootstrap Gossipcat — Design Spec

> Dynamic prompt generator that teaches any orchestrator (Claude, Gemini, GPT, CLI chat) how to use gossipcat — replaces static CLAUDE.md/rules files with live, context-aware bootstrap.

**Date:** 2026-03-22
**Status:** Draft
**Dependencies:** CLI/MCP Parity (shipped), Agent Memory (shipped), Skill Catalog (shipped)

---

## Problem Statement

Gossipcat's "how to use me" knowledge is split across static files: `CLAUDE.md` (~100 lines), `.claude/rules/gossipcat.md` (~97 lines). These files:

1. **Go stale** — agents added/removed via config aren't reflected until someone manually updates the docs
2. **Are Claude Code-specific** — `.claude/rules/` means nothing to Gemini or GPT orchestrators
3. **Have no live context** — don't know which agents have experience, what they've worked on recently, or what skills are available
4. **Config is scattered** — `gossip.agents.json` at project root, `.gossip/agents/` for memory, `.claude/rules/` for dispatch rules

## Design Overview

**A `BootstrapGenerator` in the orchestrator package that reads live state and produces a self-contained markdown prompt.** Both MCP and CLI call it. It replaces static files with a generated `.gossip/bootstrap.md`.

```
BEFORE:
  CLAUDE.md (manual, gossipcat section)  ← stale, Claude-only
  .claude/rules/gossipcat.md (manual)    ← stale, Claude-only
  gossip.agents.json (project root)      ← scattered

AFTER:
  .gossip/config.json                    ← unified config location
  .gossip/bootstrap.md                   ← generated, always fresh
  CLAUDE.md                              ← slim pointer: "read .gossip/bootstrap.md"
```

---

## Component 1: Unified `.gossip/` Directory

Move all gossipcat configuration under `.gossip/`:

```
.gossip/
  config.json              ← agent config (moved from gossip.agents.json)
  bootstrap.md             ← generated prompt
  agents/
    <agent-id>/
      memory/              ← MEMORY.md, tasks.jsonl, knowledge/, calibration/
      skills/              ← agent-local skills
      instructions.md      ← agent instructions
  skills/                  ← project-wide skills
  task-graph.jsonl         ← task event log
  task-graph-index.json
  task-graph-sync.json
  skill-gaps.jsonl
```

### Config Migration

`findConfigPath()` in `apps/cli/src/config.ts` changes lookup order:

```typescript
const candidates = [
  resolve(projectRoot, '.gossip', 'config.json'),     // NEW — preferred
  resolve(projectRoot, 'gossip.agents.json'),          // OLD — backward compat
  resolve(projectRoot, 'gossip.agents.yaml'),
  resolve(projectRoot, 'gossip.agents.yml'),
];
```

**Auto-migration:** On first run, if `.gossip/config.json` doesn't exist but `gossip.agents.json` does, the bootstrap generator copies it to `.gossip/config.json`. The old file is left in place (not deleted) for backward compat — it becomes stale but doesn't break anything.

---

## Component 2: BootstrapGenerator

### Interface

```typescript
// packages/orchestrator/src/bootstrap.ts

export interface BootstrapResult {
  prompt: string;       // The generated markdown prompt
  tier: 'no-config' | 'no-memory' | 'full';
  agentCount: number;
}

export class BootstrapGenerator {
  constructor(private projectRoot: string) {}

  generate(): BootstrapResult;
}
```

### Three-Tier Output

**Tier 1: No config** — `.gossip/config.json` and `gossip.agents.json` both missing.

Returns setup guidance:

```markdown
# Gossipcat — Multi-Agent Orchestration

Gossipcat is not configured yet. To set up your multi-agent team:

1. Decide which LLM providers you have API keys for (google, openai, anthropic, local)
2. Call gossip_setup() with your desired team configuration

Example:
gossip_setup({
  main_agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
  agents: {
    "gemini-reviewer": { provider: "google", model: "gemini-2.5-pro", preset: "reviewer", skills: ["code_review", "security_audit"] },
    "gemini-tester": { provider: "google", model: "gemini-2.5-flash", preset: "tester", skills: ["testing", "debugging"] }
  }
})

Available presets: reviewer, researcher, implementer, tester, debugger
Available skills: [list from catalog.json]
```

**Tier 2: Config exists, no memory** — agents configured but fresh (no tasks.jsonl).

Full prompt with agent roster and dispatch rules, but agent entries say "no task history yet."

**Tier 3: Full** — config + memory available.

Full prompt with live agent context:

```markdown
# Gossipcat — Multi-Agent Orchestration

## Your Team

- **gemini-reviewer**: google/gemini-2.5-pro (reviewer)
  Skills: code_review, security_audit, debugging, typescript, system_design
  Recent: 18 tasks, last active 2026-03-22
  Topics: CLI/MCP parity review, security audits, spec compliance

- **gemini-tester**: google/gemini-2.5-flash (tester)
  Skills: testing, debugging, typescript, code_review
  Recent: 10 tasks, last active 2026-03-22
  Topics: test coverage audits, buildability reviews

- **sonnet-implementer**: anthropic/claude-sonnet-4-6 (implementer)
  Skills: typescript, implementation, testing
  No task history yet

## Tools

| Tool | Description |
|------|-------------|
| `gossip_dispatch(agent_id, task)` | Send task to one agent. Returns task ID. |
| `gossip_dispatch_parallel(tasks)` | Fan out to multiple agents simultaneously. |
| `gossip_collect(task_ids?, timeout_ms?)` | Collect results. Waits for completion. |
| `gossip_bootstrap()` | Refresh this prompt with latest team state. |
| `gossip_setup(config)` | Create or update team configuration. |
| `gossip_orchestrate(task)` | Auto-decompose task via MainAgent. |
| `gossip_agents()` | List current agents. |
| `gossip_status()` | Check system status. |
| `gossip_update_instructions(agent_ids, instruction_update, mode)` | Update agent instructions at runtime. |
| `gossip_tools()` | List all available tools. |

## Dispatch Rules

### Use parallel multi-agent dispatch for:
| Task Type | Why | Split Strategy |
|-----------|-----|----------------|
| Security review | Different agents catch different vulnerability classes | Split by package |
| Code review | Cross-validation finds bugs single reviewers miss | Split by concern (logic, style, perf) |
| Bug investigation | Competing hypotheses tested in parallel | One agent per hypothesis |
| Architecture review | Multiple perspectives on trade-offs | Split by dimension |

### Single agent is fine for:
- Quick lookups, simple implementations, running tests, file reads

### Pattern:
gossip_dispatch_parallel(tasks: [
  { agent_id: "<reviewer>", task: "Review X for <concern>" },
  { agent_id: "<tester>", task: "Review Y for <concern>" }
])
Then collect and synthesize results.

## Memory

Agent memory is auto-managed:
- **MCP dispatch/collect**: Memory loaded at dispatch, written at collect. No manual action.
- **CLI chat (handleMessage)**: Same pipeline — memory loaded and written automatically.
- **Native Claude Agent tool**: Bypasses gossipcat pipeline. Manually read .gossip/agents/<id>/memory/MEMORY.md and include in prompt. Write task entry to tasks.jsonl after completion.

Skills are auto-injected from agent config. Project-wide skills in .gossip/skills/.
```

### Data Sources

The generator reads:

| Data | Source | Purpose |
|------|--------|---------|
| Agent roster | `.gossip/config.json` (or `gossip.agents.json`) | Team listing, skills |
| Memory summaries | `.gossip/agents/<id>/memory/MEMORY.md` | Recent tasks, knowledge topics |
| Task count | `.gossip/agents/<id>/memory/tasks.jsonl` (line count) | Activity level |
| Last active | `.gossip/agents/<id>/memory/tasks.jsonl` (last entry timestamp) | Recency |
| Available skills | `default-skills/catalog.json` | Skill list for setup guidance |

All reads are synchronous (fs.readFileSync) since this runs at boot, not in a hot path.

---

## Component 3: gossip_setup() MCP Tool

New MCP tool for first-time setup and config updates.

```typescript
server.tool(
  'gossip_setup',
  'Create or update gossipcat team configuration. Writes .gossip/config.json.',
  {
    config: z.object({
      main_agent: z.object({
        provider: z.string(),
        model: z.string(),
      }),
      agents: z.record(z.object({
        provider: z.string(),
        model: z.string(),
        preset: z.string().optional(),
        skills: z.array(z.string()),
      })).optional(),
    }),
  },
  async ({ config }) => {
    // Validate config (reuse existing validateConfig)
    // Write to .gossip/config.json
    // Return success + hint to call gossip_bootstrap()
  }
);
```

**Validation:** Same `validateConfig()` from `apps/cli/src/config.ts` — checks valid providers, required fields, at least one skill per agent.

**Behavior:**
- Creates `.gossip/` directory if needed
- Writes `.gossip/config.json`
- Returns: "Config saved. X agents configured. Call gossip_bootstrap() to see your team."
- Does NOT auto-bootstrap (keeps tools orthogonal)

---

## Component 4: Integration Points

### MCP Server Boot (`doBoot()`)

After booting relay, workers, and MainAgent, call the generator:

```typescript
// At end of doBoot()
const { BootstrapGenerator } = await import('@gossip/orchestrator');
const generator = new BootstrapGenerator(process.cwd());
const { prompt } = generator.generate();
writeFileSync(join(process.cwd(), '.gossip', 'bootstrap.md'), prompt);
```

Silent — no tool call, just writes the file at startup.

### MCP Tool (`gossip_bootstrap()`)

```typescript
server.tool(
  'gossip_bootstrap',
  'Generate team context prompt with live agent state. Refreshes .gossip/bootstrap.md.',
  {},
  async () => {
    const generator = new BootstrapGenerator(process.cwd());
    const result = generator.generate();
    writeFileSync(join(process.cwd(), '.gossip', 'bootstrap.md'), result.prompt);
    return { content: [{ type: 'text', text: result.prompt }] };
  }
);
```

Returns the prompt AND writes the file.

### CLI Chat Boot (`startChat()`)

```typescript
// In startChat(), after MainAgent is created
const { BootstrapGenerator } = await import('@gossip/orchestrator');
const generator = new BootstrapGenerator(process.cwd());
const { prompt } = generator.generate();
// Inject into MainAgent system prompt (prepend to CHAT_SYSTEM_PROMPT)
```

The CLI chat's MainAgent gets the bootstrap context in its system prompt, so it knows about the team when decomposing tasks.

### CLAUDE.md Update

The gossipcat section in CLAUDE.md slims to:

```markdown
## Gossipcat — Multi-Agent Orchestration

Team context is auto-generated at `.gossip/bootstrap.md`.
Call `gossip_bootstrap()` to refresh after adding/removing agents.

For full team context, tools, dispatch rules, and memory handling,
read `.gossip/bootstrap.md`.
```

The `.claude/rules/gossipcat.md` file is deleted — replaced by `.gossip/bootstrap.md`.

---

## Component 5: Config Migration

### `migrateConfig()` in bootstrap.ts

```typescript
function migrateConfig(projectRoot: string): void {
  const oldPath = resolve(projectRoot, 'gossip.agents.json');
  const newPath = resolve(projectRoot, '.gossip', 'config.json');

  if (!existsSync(newPath) && existsSync(oldPath)) {
    mkdirSync(resolve(projectRoot, '.gossip'), { recursive: true });
    copyFileSync(oldPath, newPath);
  }
}
```

Called at the start of `generate()`. Non-destructive — copies, doesn't move. Old file stays for backward compat until user deletes it manually.

`findConfigPath()` updated to check `.gossip/config.json` first.

---

## Files Changed

| File | Action | Change |
|------|--------|--------|
| `packages/orchestrator/src/bootstrap.ts` | **Create** | BootstrapGenerator class (~120 lines) |
| `packages/orchestrator/src/index.ts` | **Edit** | Export BootstrapGenerator |
| `apps/cli/src/config.ts` | **Edit** | Update findConfigPath() lookup order |
| `apps/cli/src/mcp-server-sdk.ts` | **Edit** | Add gossip_bootstrap + gossip_setup tools, call generator in doBoot() |
| `apps/cli/src/chat.ts` | **Edit** | Inject bootstrap prompt into MainAgent system prompt |
| `CLAUDE.md` | **Edit** | Slim gossipcat section to pointer |
| `.claude/rules/gossipcat.md` | **Delete** | Replaced by .gossip/bootstrap.md |
| `tests/orchestrator/bootstrap.test.ts` | **Create** | Test all three tiers, migration, prompt content |

---

## Testing Strategy

- **Tier detection:** Unit test — no config returns 'no-config' tier, config-only returns 'no-memory', config+memory returns 'full'
- **Prompt content:** Unit test — verify team section includes agent names/skills, tools section lists all tools, dispatch rules present
- **Memory integration:** Unit test — with mock tasks.jsonl and MEMORY.md, verify task count and topics appear in prompt
- **Config migration:** Unit test — verify old config is copied to new location, new location takes precedence
- **MCP tools:** Integration test — gossip_setup writes config, gossip_bootstrap returns prompt with agents from that config
- **Regression:** All existing tests must pass (config path change is backward-compatible)

---

## Security Constraints

- `gossip_setup` validates config with same `validateConfig()` as CLI (provider whitelist, required fields)
- Config file writes use `mkdirSync` + `writeFileSync` — no shell execution
- Bootstrap prompt is generated from trusted local files only — no network calls
- Agent memory content is included as-is (already sanitized at write time by MemoryWriter)
- `gossip_setup` does NOT accept API keys — those go through the Keychain (separate secure storage)
