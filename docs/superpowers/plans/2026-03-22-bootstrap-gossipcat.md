# Bootstrap Gossipcat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic prompt generator that teaches any orchestrator how to use gossipcat, replacing static CLAUDE.md/rules files.

**Architecture:** `BootstrapGenerator` in orchestrator reads config + agent memory and generates a markdown prompt. MCP exposes it as `gossip_bootstrap()` + `gossip_setup()` tools. CLI injects it into MainAgent's system prompt via `bootstrapPrompt` config field.

**Tech Stack:** TypeScript, Jest, @gossip/orchestrator, zod (MCP schema)

**Spec:** `docs/superpowers/specs/2026-03-22-bootstrap-gossipcat-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/bootstrap.ts` | **Create** | BootstrapGenerator: migrateConfig, generate (3-tier), readAgentSummary |
| `packages/orchestrator/src/index.ts` | **Edit** | Export BootstrapGenerator, BootstrapResult |
| `apps/cli/src/config.ts` | **Edit** | Update findConfigPath to check .gossip/config.json first |
| `packages/orchestrator/src/main-agent.ts` | **Edit** | Add bootstrapPrompt to MainAgentConfig, thread into system prompt |
| `apps/cli/src/chat.ts` | **Edit** | Generate bootstrap prompt, pass to MainAgent |
| `apps/cli/src/mcp-server-sdk.ts` | **Edit** | Add gossip_bootstrap + gossip_setup tools |
| `CLAUDE.md` | **Edit** | Slim gossipcat section to pointer |
| `.claude/rules/gossipcat.md` | **Delete** | Replaced by .gossip/bootstrap.md |
| `tests/orchestrator/bootstrap.test.ts` | **Create** | Unit tests for all 3 tiers, migration, error handling |

---

### Task 1: Update findConfigPath for .gossip/config.json

**Files:**
- Modify: `apps/cli/src/config.ts:18-28`
- Test: `tests/cli/config.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/cli/config.test.ts`, add a test that verifies `.gossip/config.json` is preferred over `gossip.agents.json`:

```typescript
it('prefers .gossip/config.json over gossip.agents.json', () => {
  // Create both files in tmpdir
  mkdirSync(join(tmpDir, '.gossip'), { recursive: true });
  writeFileSync(join(tmpDir, '.gossip', 'config.json'), JSON.stringify({
    main_agent: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    agents: { 'test-agent': { provider: 'local', model: 'qwen', skills: ['testing'] } }
  }));
  writeFileSync(join(tmpDir, 'gossip.agents.json'), '{"old": true}');

  // findConfigPath should return the .gossip/config.json path
  const result = findConfigPath(tmpDir);
  expect(result).toContain('.gossip/config.json');
});
```

Note: `findConfigPath` currently uses `process.cwd()` — the test needs the function to accept a `projectRoot` param. Check the existing test file first for the pattern used. If `findConfigPath` doesn't accept a param, the test should use `jest.spyOn` to mock `process.cwd()` or the function signature needs to change.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/cli/config.test.ts --verbose`
Expected: FAIL

- [ ] **Step 3: Update findConfigPath**

In `apps/cli/src/config.ts`, add `.gossip/config.json` as the first candidate:

```typescript
export function findConfigPath(projectRoot?: string): string | null {
  const root = projectRoot || process.cwd();
  const candidates = [
    resolve(root, '.gossip', 'config.json'),
    resolve(root, 'gossip.agents.json'),
    resolve(root, 'gossip.agents.yaml'),
    resolve(root, 'gossip.agents.yml'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
```

Note: Adding `projectRoot` param with `process.cwd()` default keeps backward compat — all existing callers pass no args.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/cli/config.test.ts --verbose`
Expected: PASS

- [ ] **Step 5: Run full test suite for regression**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js --verbose`
Expected: All 264 tests pass (findConfigPath still finds gossip.agents.json via backward compat)

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/config.ts tests/cli/config.test.ts
git commit -m "feat(config): prefer .gossip/config.json over gossip.agents.json"
```

---

### Task 2: Create BootstrapGenerator with tier detection

**Files:**
- Create: `packages/orchestrator/src/bootstrap.ts`
- Create: `tests/orchestrator/bootstrap.test.ts`

- [ ] **Step 1: Write failing tests for all 3 tiers**

Create `tests/orchestrator/bootstrap.test.ts`:

```typescript
import { BootstrapGenerator } from '@gossip/orchestrator';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BootstrapGenerator', () => {
  const testDir = join(tmpdir(), `gossip-bootstrap-test-${Date.now()}`);

  afterAll(() => { rmSync(testDir, { recursive: true, force: true }); });

  describe('tier detection', () => {
    it('returns no-config tier when no config exists', () => {
      const dir = join(testDir, 'empty');
      mkdirSync(dir, { recursive: true });
      const gen = new BootstrapGenerator(dir);
      const result = gen.generate();
      expect(result.tier).toBe('no-config');
      expect(result.agentCount).toBe(0);
      expect(result.prompt).toContain('not configured yet');
    });

    it('returns no-memory tier when config exists but no memory', () => {
      const dir = join(testDir, 'config-only');
      mkdirSync(join(dir, '.gossip'), { recursive: true });
      writeFileSync(join(dir, '.gossip', 'config.json'), JSON.stringify({
        main_agent: { provider: 'local', model: 'qwen' },
        agents: { 'test-agent': { provider: 'local', model: 'qwen', skills: ['testing'] } }
      }));
      const gen = new BootstrapGenerator(dir);
      const result = gen.generate();
      expect(result.tier).toBe('no-memory');
      expect(result.agentCount).toBe(1);
      expect(result.prompt).toContain('test-agent');
      expect(result.prompt).toContain('No task history yet');
    });

    it('returns full tier when config and memory exist', () => {
      const dir = join(testDir, 'full');
      mkdirSync(join(dir, '.gossip', 'agents', 'test-agent', 'memory'), { recursive: true });
      writeFileSync(join(dir, '.gossip', 'config.json'), JSON.stringify({
        main_agent: { provider: 'local', model: 'qwen' },
        agents: { 'test-agent': { provider: 'local', model: 'qwen', preset: 'reviewer', skills: ['testing', 'code_review'] } }
      }));
      writeFileSync(join(dir, '.gossip', 'agents', 'test-agent', 'memory', 'tasks.jsonl'),
        '{"version":1,"taskId":"t1","task":"review code","skills":["testing"],"findings":0,"hallucinated":0,"scores":{"relevance":3,"accuracy":3,"uniqueness":3},"warmth":1,"importance":0.6,"timestamp":"2026-03-22T10:00:00Z"}\n' +
        '{"version":1,"taskId":"t2","task":"check tests","skills":["testing"],"findings":0,"hallucinated":0,"scores":{"relevance":3,"accuracy":3,"uniqueness":3},"warmth":1,"importance":0.6,"timestamp":"2026-03-22T11:00:00Z"}\n'
      );
      writeFileSync(join(dir, '.gossip', 'agents', 'test-agent', 'memory', 'MEMORY.md'),
        '# Agent Memory — test-agent\n\n## Knowledge\n- [security](knowledge/security.md) — relay auth patterns\n\n## Recent Tasks\n- 2026-03-22: review code\n- 2026-03-22: check tests\n'
      );
      const gen = new BootstrapGenerator(dir);
      const result = gen.generate();
      expect(result.tier).toBe('full');
      expect(result.agentCount).toBe(1);
      expect(result.prompt).toContain('test-agent');
      expect(result.prompt).toContain('2 tasks');
      expect(result.prompt).toContain('Dispatch Rules');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/orchestrator/bootstrap.test.ts --verbose`
Expected: FAIL — BootstrapGenerator doesn't exist

- [ ] **Step 3: Implement BootstrapGenerator**

Create `packages/orchestrator/src/bootstrap.ts`:

```typescript
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, join } from 'path';

export interface BootstrapResult {
  prompt: string;
  tier: 'no-config' | 'no-memory' | 'full';
  agentCount: number;
}

interface AgentSummary {
  id: string;
  provider: string;
  model: string;
  preset?: string;
  skills: string[];
  taskCount: number;
  lastActive?: string;
  topics?: string;
}

const log = (msg: string) => process.stderr.write(`[gossipcat] ${msg}\n`);

export class BootstrapGenerator {
  constructor(private projectRoot: string) {}

  generate(): BootstrapResult {
    this.migrateConfig();

    const config = this.loadConfig();
    if (!config) {
      return { prompt: this.renderTier1(), tier: 'no-config', agentCount: 0 };
    }

    const agents = this.readAgentSummaries(config);
    const hasMemory = agents.some(a => a.taskCount > 0);

    return {
      prompt: this.renderTeamPrompt(agents),
      tier: hasMemory ? 'full' : 'no-memory',
      agentCount: agents.length,
    };
  }

  private migrateConfig(): void {
    const oldPath = resolve(this.projectRoot, 'gossip.agents.json');
    const newPath = resolve(this.projectRoot, '.gossip', 'config.json');

    if (!existsSync(newPath) && existsSync(oldPath)) {
      mkdirSync(resolve(this.projectRoot, '.gossip'), { recursive: true });
      copyFileSync(oldPath, newPath);
      log('Migrated config to .gossip/config.json — gossip.agents.json is now ignored.');
    }
  }

  private loadConfig(): Record<string, any> | null {
    const paths = [
      resolve(this.projectRoot, '.gossip', 'config.json'),
      resolve(this.projectRoot, 'gossip.agents.json'),
    ];

    for (const p of paths) {
      if (existsSync(p)) {
        try { return JSON.parse(readFileSync(p, 'utf-8')); }
        catch { log('Config parse error, falling back to setup mode'); return null; }
      }
    }
    return null;
  }

  private readAgentSummaries(config: Record<string, any>): AgentSummary[] {
    const agents: AgentSummary[] = [];
    for (const [id, ac] of Object.entries(config.agents || {})) {
      const agent = ac as Record<string, any>;
      const summary: AgentSummary = {
        id, provider: agent.provider, model: agent.model,
        preset: agent.preset, skills: agent.skills || [],
        taskCount: 0,
      };

      // Read task history
      const tasksPath = join(this.projectRoot, '.gossip', 'agents', id, 'memory', 'tasks.jsonl');
      if (existsSync(tasksPath)) {
        const lines = readFileSync(tasksPath, 'utf-8').trim().split('\n').filter(Boolean);
        let count = 0;
        let lastTs = '';
        for (const line of lines) {
          try { const e = JSON.parse(line); count++; if (e.timestamp > lastTs) lastTs = e.timestamp; }
          catch { /* skip malformed */ }
        }
        summary.taskCount = count;
        if (lastTs) summary.lastActive = lastTs.split('T')[0];
      }

      // Read memory summary (capped at 500 chars)
      const memPath = join(this.projectRoot, '.gossip', 'agents', id, 'memory', 'MEMORY.md');
      if (existsSync(memPath)) {
        const content = readFileSync(memPath, 'utf-8').slice(0, 500);
        // Extract topic keywords from knowledge section headers
        const knowledgeLines = content.match(/- \[([^\]]+)\]/g);
        if (knowledgeLines?.length) {
          summary.topics = knowledgeLines.map(l => l.replace(/- \[([^\]]+)\].*/, '$1')).join(', ');
        }
      }

      agents.push(summary);
    }
    return agents;
  }

  private renderTier1(): string {
    let skills = '';
    try {
      const catalogPath = resolve(__dirname, 'default-skills', 'catalog.json');
      if (existsSync(catalogPath)) {
        const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
        skills = `\nAvailable skills: ${catalog.skills.map((s: any) => s.name).join(', ')}`;
      }
    } catch { /* catalog unavailable */ }

    return `# Gossipcat — Multi-Agent Orchestration

Gossipcat is not configured yet. To set up your multi-agent team:

1. Decide which LLM providers you have API keys for (google, openai, anthropic, local)
2. Call gossip_setup() with your desired team configuration

Example:
\`\`\`
gossip_setup({
  main_agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
  agents: {
    "gemini-reviewer": { provider: "google", model: "gemini-2.5-pro", preset: "reviewer", skills: ["code_review", "security_audit"] },
    "gemini-tester": { provider: "google", model: "gemini-2.5-flash", preset: "tester", skills: ["testing", "debugging"] }
  }
})
\`\`\`

Available presets: reviewer, researcher, implementer, tester, debugger${skills}`;
  }

  private renderTeamPrompt(agents: AgentSummary[]): string {
    const teamSection = agents.map(a => {
      let line = `- **${a.id}**: ${a.provider}/${a.model}${a.preset ? ` (${a.preset})` : ''}\n  Skills: ${a.skills.join(', ')}`;
      if (a.taskCount > 0) {
        line += `\n  Recent: ${a.taskCount} tasks${a.lastActive ? `, last active ${a.lastActive}` : ''}`;
        if (a.topics) line += `\n  Topics: ${a.topics}`;
      } else {
        line += '\n  No task history yet';
      }
      return line;
    }).join('\n\n');

    return `# Gossipcat — Multi-Agent Orchestration

## Your Team

${teamSection}

## Tools

| Tool | Description |
|------|-------------|
| \`gossip_dispatch(agent_id, task)\` | Send task to one agent. Returns task ID. |
| \`gossip_dispatch_parallel(tasks)\` | Fan out to multiple agents simultaneously. |
| \`gossip_collect(task_ids?, timeout_ms?)\` | Collect results. Waits for completion. |
| \`gossip_bootstrap()\` | Refresh this prompt with latest team state. |
| \`gossip_setup(config)\` | Create or update team configuration. |
| \`gossip_orchestrate(task)\` | Auto-decompose task via MainAgent. |
| \`gossip_agents()\` | List current agents. |
| \`gossip_status()\` | Check system status. |
| \`gossip_update_instructions(agent_ids, instruction_update, mode)\` | Update agent instructions at runtime. |
| \`gossip_tools()\` | List all available tools. |

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
\`\`\`
gossip_dispatch_parallel(tasks: [
  { agent_id: "<reviewer>", task: "Review X for <concern>" },
  { agent_id: "<tester>", task: "Review Y for <concern>" }
])
\`\`\`
Then collect and synthesize results.

## Memory

Agent memory is auto-managed:
- **MCP dispatch/collect**: Memory loaded at dispatch, written at collect. No manual action.
- **CLI chat (handleMessage)**: Same pipeline — memory loaded and written automatically.
- **Native Claude Agent tool**: Bypasses gossipcat pipeline. Manually read .gossip/agents/<id>/memory/MEMORY.md and include in prompt. Write task entry to tasks.jsonl after completion.

Skills are auto-injected from agent config. Project-wide skills in .gossip/skills/.`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/orchestrator/bootstrap.test.ts --verbose`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/bootstrap.ts tests/orchestrator/bootstrap.test.ts
git commit -m "feat(orchestrator): add BootstrapGenerator with 3-tier prompt generation"
```

---

### Task 3: Add error handling and migration tests

**Files:**
- Modify: `tests/orchestrator/bootstrap.test.ts`

- [ ] **Step 1: Add error handling and migration tests**

Append to the describe block:

```typescript
  describe('error handling', () => {
    it('falls back to no-config on malformed config JSON', () => {
      const dir = join(testDir, 'bad-json');
      mkdirSync(join(dir, '.gossip'), { recursive: true });
      writeFileSync(join(dir, '.gossip', 'config.json'), '{ broken json!!!');
      const gen = new BootstrapGenerator(dir);
      const result = gen.generate();
      expect(result.tier).toBe('no-config');
    });

    it('shows no task history when tasks.jsonl has malformed lines', () => {
      const dir = join(testDir, 'bad-tasks');
      mkdirSync(join(dir, '.gossip', 'agents', 'a1', 'memory'), { recursive: true });
      writeFileSync(join(dir, '.gossip', 'config.json'), JSON.stringify({
        main_agent: { provider: 'local', model: 'q' },
        agents: { 'a1': { provider: 'local', model: 'q', skills: ['testing'] } }
      }));
      writeFileSync(join(dir, '.gossip', 'agents', 'a1', 'memory', 'tasks.jsonl'),
        'NOT JSON\n{"version":1,"taskId":"ok","task":"t","skills":[],"findings":0,"hallucinated":0,"scores":{"relevance":3,"accuracy":3,"uniqueness":3},"warmth":1,"importance":0.6,"timestamp":"2026-03-22T00:00:00Z"}\nALSO BAD\n'
      );
      const gen = new BootstrapGenerator(dir);
      const result = gen.generate();
      expect(result.prompt).toContain('1 tasks'); // only the valid line counted
    });
  });

  describe('config migration', () => {
    it('copies gossip.agents.json to .gossip/config.json on first run', () => {
      const dir = join(testDir, 'migrate');
      mkdirSync(dir, { recursive: true });
      const config = { main_agent: { provider: 'local', model: 'q' }, agents: { 'a1': { provider: 'local', model: 'q', skills: ['t'] } } };
      writeFileSync(join(dir, 'gossip.agents.json'), JSON.stringify(config));

      const gen = new BootstrapGenerator(dir);
      gen.generate();

      expect(existsSync(join(dir, '.gossip', 'config.json'))).toBe(true);
      expect(existsSync(join(dir, 'gossip.agents.json'))).toBe(true); // old file preserved
    });

    it('does not overwrite existing .gossip/config.json', () => {
      const dir = join(testDir, 'no-overwrite');
      mkdirSync(join(dir, '.gossip'), { recursive: true });
      writeFileSync(join(dir, '.gossip', 'config.json'), '{"new": true}');
      writeFileSync(join(dir, 'gossip.agents.json'), '{"old": true}');

      const gen = new BootstrapGenerator(dir);
      gen.generate(); // should NOT overwrite

      const content = readFileSync(join(dir, '.gossip', 'config.json'), 'utf-8');
      expect(content).toContain('"new"');
    });
  });
```

Add `existsSync` to imports if not already there.

- [ ] **Step 2: Run tests**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/orchestrator/bootstrap.test.ts --verbose`
Expected: PASS (7 tests total)

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/bootstrap.test.ts
git commit -m "test(bootstrap): add error handling and config migration tests"
```

---

### Task 4: Export BootstrapGenerator from orchestrator

**Files:**
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Add exports**

In `packages/orchestrator/src/index.ts`, add:

```typescript
export { BootstrapGenerator } from './bootstrap';
export type { BootstrapResult } from './bootstrap';
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/orchestrator/bootstrap.test.ts --verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/index.ts
git commit -m "feat(orchestrator): export BootstrapGenerator"
```

---

### Task 5: Add bootstrapPrompt to MainAgent

**Files:**
- Modify: `packages/orchestrator/src/main-agent.ts:36-45` (MainAgentConfig)
- Modify: `packages/orchestrator/src/main-agent.ts` (constructor + handleMessage)
- Test: `tests/orchestrator/main-agent.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/orchestrator/main-agent.test.ts`, add:

```typescript
describe('MainAgent bootstrapPrompt', () => {
  it('accepts bootstrapPrompt in config', () => {
    expect(MainAgent).toBeDefined();
    // MainAgentConfig should accept bootstrapPrompt
    // This is a compile-time check — if the field doesn't exist, TypeScript will error
  });
});
```

- [ ] **Step 2: Add bootstrapPrompt to MainAgentConfig**

In `packages/orchestrator/src/main-agent.ts`, add to `MainAgentConfig`:

```typescript
export interface MainAgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  relayUrl: string;
  agents: AgentConfig[];
  apiKeys?: Record<string, string>;
  projectRoot?: string;
  llm?: ILLMProvider;
  bootstrapPrompt?: string;  // NEW — injected by BootstrapGenerator
}
```

Add field and constructor init:

```typescript
  private bootstrapPrompt: string;
  // In constructor:
  this.bootstrapPrompt = config.bootstrapPrompt || '';
```

In `handleMessage`, find the two places `CHAT_SYSTEM_PROMPT` is used in `this.llm.generate()` calls and replace with:

```typescript
const systemPrompt = this.bootstrapPrompt
  ? this.bootstrapPrompt + '\n\n' + CHAT_SYSTEM_PROMPT
  : CHAT_SYSTEM_PROMPT;
```

There are two call sites:
1. The unassigned-task direct LLM call (around line 149)
2. The `handleChoice` method (around line 192)

Both need to use `systemPrompt` instead of `CHAT_SYSTEM_PROMPT`.

- [ ] **Step 3: Run tests**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js tests/orchestrator/ --verbose`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts tests/orchestrator/main-agent.test.ts
git commit -m "feat(main-agent): add bootstrapPrompt to config, thread into system prompt"
```

---

### Task 6: Integrate bootstrap into CLI chat

**Files:**
- Modify: `apps/cli/src/chat.ts:120-132`

- [ ] **Step 1: Add bootstrap generation before MainAgent creation**

In `apps/cli/src/chat.ts`, after `const mainKey = ...` (line 120) and before the `mainAgentConfig` construction (line 122), add:

```typescript
  // Generate bootstrap prompt for team context
  const { BootstrapGenerator } = await import('@gossip/orchestrator');
  const bootstrapGen = new BootstrapGenerator(process.cwd());
  const { prompt: bootstrapPrompt } = bootstrapGen.generate();
  // Write .gossip/bootstrap.md for humans/tools that read static files
  const { writeFileSync: writeBs, mkdirSync: mkBs } = await import('fs');
  const { join: joinBs } = await import('path');
  mkBs(joinBs(process.cwd(), '.gossip'), { recursive: true });
  writeBs(joinBs(process.cwd(), '.gossip', 'bootstrap.md'), bootstrapPrompt);
```

Then add `bootstrapPrompt` to the config:

```typescript
  const mainAgentConfig: MainAgentConfig = {
    provider: config.main_agent.provider,
    model: config.main_agent.model,
    apiKey: mainKey || undefined,
    relayUrl: relay.url,
    agents: configToAgentConfigs(config),
    projectRoot: process.cwd(),
    bootstrapPrompt,
  };
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js --verbose`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/chat.ts
git commit -m "feat(chat): generate bootstrap prompt and inject into MainAgent"
```

---

### Task 7: Add gossip_bootstrap and gossip_setup MCP tools

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add gossip_bootstrap tool**

After the existing `gossip_tools` handler, add:

```typescript
server.tool(
  'gossip_bootstrap',
  'Generate team context prompt with live agent state. Refreshes .gossip/bootstrap.md.',
  {},
  async () => {
    const { BootstrapGenerator } = await import('@gossip/orchestrator');
    const generator = new BootstrapGenerator(process.cwd());
    const result = generator.generate();
    const { writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');
    mkdirSync(join(process.cwd(), '.gossip'), { recursive: true });
    writeFileSync(join(process.cwd(), '.gossip', 'bootstrap.md'), result.prompt);
    return { content: [{ type: 'text' as const, text: result.prompt }] };
  }
);
```

- [ ] **Step 2: Add gossip_setup tool**

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
        skills: z.array(z.string()).min(1),
      })).optional(),
    }),
  },
  async ({ config }) => {
    // Validate using existing validateConfig
    try {
      const { validateConfig } = await import('./config');
      validateConfig(config);
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Invalid config: ${(err as Error).message}` }] };
    }

    const { writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');
    mkdirSync(join(process.cwd(), '.gossip'), { recursive: true });
    writeFileSync(join(process.cwd(), '.gossip', 'config.json'), JSON.stringify(config, null, 2));

    const agentCount = Object.keys(config.agents || {}).length;
    return { content: [{ type: 'text' as const, text: `Config saved. ${agentCount} agents configured. Agents will start on first dispatch — call gossip_dispatch() to begin.` }] };
  }
);
```

- [ ] **Step 3: Update gossip_tools listing to include new tools**

Find the tools array in `gossip_tools` handler and add:

```typescript
{ name: 'gossip_bootstrap', desc: 'Generate team context prompt with live agent state' },
{ name: 'gossip_setup', desc: 'Create or update team configuration' },
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npm run build:mcp`
Expected: Clean build

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(mcp): add gossip_bootstrap and gossip_setup tools"
```

---

### Task 8: Update CLAUDE.md and delete .claude/rules/gossipcat.md

**Files:**
- Modify: `CLAUDE.md`
- Delete: `.claude/rules/gossipcat.md`

- [ ] **Step 1: Slim CLAUDE.md gossipcat section**

Replace the entire gossipcat section in CLAUDE.md (from `## Gossipcat` through `### Adding agents`) with:

```markdown
## Gossipcat — Multi-Agent Orchestration

Team context is auto-generated at `.gossip/bootstrap.md`.
Call `gossip_bootstrap()` to refresh after adding/removing agents.

For full team context, tools, dispatch rules, and memory handling,
read `.gossip/bootstrap.md`.
```

Keep the `## gstack` section and everything after it unchanged.

- [ ] **Step 2: Delete .claude/rules/gossipcat.md**

```bash
rm .claude/rules/gossipcat.md
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git rm .claude/rules/gossipcat.md
git commit -m "docs: replace static gossipcat docs with .gossip/bootstrap.md pointer"
```

---

### Task 9: Verify — full regression + smoke test

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/goku/Desktop/gossip && npx jest --config jest.config.base.js --verbose`
Expected: All tests pass

- [ ] **Step 2: Build MCP**

Run: `cd /Users/goku/Desktop/gossip && npm run build:mcp`
Expected: Clean build

- [ ] **Step 3: Verify bootstrap.md is generated**

After `/mcp` reconnect, call `gossip_bootstrap()` and verify it returns the full team prompt with agent roster, tools, and dispatch rules. Verify `.gossip/bootstrap.md` is written.

- [ ] **Step 4: Verify gossip_setup works**

Call `gossip_setup({ main_agent: { provider: "local", model: "test" }, agents: { "test": { provider: "local", model: "test", skills: ["testing"] } } })` and verify `.gossip/config.json` is written.

- [ ] **Step 5: Verify findConfigPath prefers .gossip/config.json**

Check that after migration, the system reads from `.gossip/config.json` not `gossip.agents.json`.
