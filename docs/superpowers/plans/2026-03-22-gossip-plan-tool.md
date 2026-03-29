# gossip_plan Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gossip_plan` MCP tool that decomposes tasks with write-mode classification, and update tool descriptions + bootstrap to make write modes discoverable.

**Architecture:** New `classifyWriteModes()` method on TaskDispatcher uses a single LLM call to classify sub-tasks as read/write with suggested write mode + scope. New `gossip_plan` MCP tool orchestrates decompose → assign → classify → format. Tool descriptions and bootstrap prompt updated to reference `gossip_plan`.

**Tech Stack:** TypeScript, Zod, @gossip/orchestrator, MCP SDK, Jest

**Spec:** `docs/superpowers/specs/2026-03-22-gossip-plan-tool-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/types.ts` | **Edit** | Add `PlannedTask` interface |
| `packages/orchestrator/src/task-dispatcher.ts` | **Edit** | Add `classifyWriteModes(plan)` method (~40 lines) |
| `packages/orchestrator/src/index.ts` | **Edit** | Export `PlannedTask` type |
| `packages/orchestrator/src/bootstrap.ts` | **Edit** | Add write modes section to `renderTeamPrompt()` |
| `apps/cli/src/mcp-server-sdk.ts` | **Edit** | Add `gossip_plan` tool, update 3 tool descriptions |
| `tests/orchestrator/task-dispatcher.test.ts` | **Create** | Tests for `classifyWriteModes` |

---

### Task 1: Add PlannedTask type

**Files:**
- Modify: `packages/orchestrator/src/types.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Add PlannedTask interface**

In `packages/orchestrator/src/types.ts`, after the `DispatchOptions` interface, add:

```typescript
/** A planned task with write-mode classification */
export interface PlannedTask {
  agentId: string;
  task: string;
  access: 'read' | 'write';
  writeMode?: 'sequential' | 'scoped' | 'worktree';
  scope?: string;
}
```

- [ ] **Step 2: Export from index**

In `packages/orchestrator/src/index.ts`, the `export * from './types'` already re-exports everything from types.ts, so `PlannedTask` will be automatically exported. Verify this by checking the existing export line.

- [ ] **Step 3: Verify build**

Run: `npx jest --config jest.config.base.js tests/orchestrator/dispatch-pipeline.test.ts --verbose`
Expected: All existing tests pass (type addition is additive)

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/types.ts
git commit -m "feat(types): add PlannedTask interface for write-mode classification"
```

---

### Task 2: Add classifyWriteModes to TaskDispatcher

**Files:**
- Modify: `packages/orchestrator/src/task-dispatcher.ts`
- Create: `tests/orchestrator/task-dispatcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/task-dispatcher.test.ts`:

```typescript
import { TaskDispatcher } from '../../packages/orchestrator/src/task-dispatcher';
import { AgentRegistry } from '../../packages/orchestrator/src/agent-registry';
import { DispatchPlan, PlannedTask } from '../../packages/orchestrator/src/types';

// Mock LLM that returns controlled responses
function mockLLM(response: string) {
  return {
    generate: jest.fn().mockResolvedValue({ text: response }),
  };
}

function makeRegistry() {
  const registry = new AgentRegistry();
  registry.register({ id: 'gemini-implementer', provider: 'google', model: 'gemini-2.5-pro', skills: ['typescript', 'implementation'] });
  registry.register({ id: 'gemini-reviewer', provider: 'google', model: 'gemini-2.5-pro', skills: ['code_review', 'security_audit'] });
  return registry;
}

function makePlan(subTasks: Array<{ description: string; assignedAgent?: string }>): DispatchPlan {
  return {
    originalTask: 'test task',
    strategy: 'parallel',
    subTasks: subTasks.map((st, i) => ({
      id: `task-${i}`,
      description: st.description,
      requiredSkills: [],
      assignedAgent: st.assignedAgent,
      status: 'pending' as const,
    })),
  };
}

describe('TaskDispatcher.classifyWriteModes', () => {
  it('classifies write tasks with scoped mode', async () => {
    const llm = mockLLM(JSON.stringify([
      { index: 0, access: 'write', write_mode: 'scoped', scope: 'packages/tools/' },
      { index: 1, access: 'read' },
    ]));
    const dispatcher = new TaskDispatcher(llm as any, makeRegistry());
    const plan = makePlan([
      { description: 'Fix bug in packages/tools/', assignedAgent: 'gemini-implementer' },
      { description: 'Review the fix', assignedAgent: 'gemini-reviewer' },
    ]);

    const result = await dispatcher.classifyWriteModes(plan);

    expect(result).toHaveLength(2);
    expect(result[0].access).toBe('write');
    expect(result[0].writeMode).toBe('scoped');
    expect(result[0].scope).toBe('packages/tools/');
    expect(result[1].access).toBe('read');
    expect(result[1].writeMode).toBeUndefined();
  });

  it('falls back to all-read on invalid LLM response', async () => {
    const llm = mockLLM('This is not JSON at all');
    const dispatcher = new TaskDispatcher(llm as any, makeRegistry());
    const plan = makePlan([
      { description: 'Fix something', assignedAgent: 'gemini-implementer' },
    ]);

    const result = await dispatcher.classifyWriteModes(plan);

    expect(result).toHaveLength(1);
    expect(result[0].access).toBe('read');
  });

  it('falls back to all-read on LLM error', async () => {
    const llm = { generate: jest.fn().mockRejectedValue(new Error('API down')) };
    const dispatcher = new TaskDispatcher(llm as any, makeRegistry());
    const plan = makePlan([
      { description: 'Fix something', assignedAgent: 'gemini-implementer' },
    ]);

    const result = await dispatcher.classifyWriteModes(plan);

    expect(result).toHaveLength(1);
    expect(result[0].access).toBe('read');
  });

  it('handles unassigned sub-tasks', async () => {
    const llm = mockLLM(JSON.stringify([
      { index: 0, access: 'write', write_mode: 'sequential' },
    ]));
    const dispatcher = new TaskDispatcher(llm as any, makeRegistry());
    const plan = makePlan([
      { description: 'Do something' }, // no assignedAgent
    ]);

    const result = await dispatcher.classifyWriteModes(plan);

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('');
    expect(result[0].access).toBe('write');
    expect(result[0].writeMode).toBe('sequential');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.base.js tests/orchestrator/task-dispatcher.test.ts --verbose`
Expected: FAIL — `classifyWriteModes` doesn't exist

- [ ] **Step 3: Implement classifyWriteModes**

In `packages/orchestrator/src/task-dispatcher.ts`, add import and method:

Add to imports:
```typescript
import { DispatchPlan, PlannedTask } from './types';
```

(Replace the existing `import { DispatchPlan } from './types';`)

Add method after `assignAgents`:

```typescript
  /**
   * Classify each sub-task as read or write and suggest write modes.
   * Falls back to all-read on LLM failure.
   */
  async classifyWriteModes(plan: DispatchPlan): Promise<PlannedTask[]> {
    const subTaskList = plan.subTasks
      .map((st, i) => `${i}. [agent: ${st.assignedAgent || 'unassigned'}] ${st.description}`)
      .join('\n');

    try {
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `Classify each sub-task as read-only or write. For write tasks, suggest a write mode and scope.

Rules:
- Tasks with action verbs (fix, implement, add, create, refactor, update, delete, write, build, migrate) → write
- Tasks with observation verbs (review, analyze, check, verify, list, explain, summarize, audit, trace) → read
- If the task mentions a specific directory or package path → write_mode: scoped, scope: that path
- If the task is broad with no clear directory boundary → write_mode: sequential
- If the task says "experiment", "try", "prototype", or "spike" → write_mode: worktree

Respond as JSON array:
[{ "index": 0, "access": "write", "write_mode": "scoped", "scope": "packages/tools/" }, { "index": 1, "access": "read" }]`,
        },
        { role: 'user', content: `Sub-tasks:\n${subTaskList}` },
      ];

      const response = await this.llm.generate(messages, { temperature: 0 });
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in response');

      const classifications = JSON.parse(jsonMatch[0]) as Array<{
        index: number;
        access: 'read' | 'write';
        write_mode?: string;
        scope?: string;
      }>;

      return plan.subTasks.map((st, i) => {
        const c = classifications.find(cl => cl.index === i);
        return {
          agentId: st.assignedAgent || '',
          task: st.description,
          access: c?.access || 'read',
          writeMode: c?.access === 'write' ? c.write_mode as PlannedTask['writeMode'] : undefined,
          scope: c?.scope,
        };
      });
    } catch {
      // Fallback: all read-only
      return plan.subTasks.map(st => ({
        agentId: st.assignedAgent || '',
        task: st.description,
        access: 'read' as const,
      }));
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx jest --config jest.config.base.js tests/orchestrator/task-dispatcher.test.ts --verbose`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full orchestrator suite**

Run: `npx jest --config jest.config.base.js tests/orchestrator/ --verbose`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/task-dispatcher.ts tests/orchestrator/task-dispatcher.test.ts
git commit -m "feat(task-dispatcher): add classifyWriteModes for read/write task classification"
```

---

### Task 3: Add gossip_plan MCP tool

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add gossip_plan tool**

In `apps/cli/src/mcp-server-sdk.ts`, after the `gossip_orchestrate` tool (around line 175), add:

```typescript
// ── Plan: decompose with write-mode classification ────────────────────────
server.tool(
  'gossip_plan',
  'Plan a task with write-mode suggestions. Decomposes into sub-tasks, assigns agents, and classifies each as read or write with suggested write mode. Returns dispatch-ready JSON for approval before execution. Use this before gossip_dispatch_parallel for implementation tasks.',
  {
    task: z.string().describe('Task description (e.g. "fix the scope validation bug in packages/tools/")'),
    strategy: z.enum(['parallel', 'sequential', 'single']).optional()
      .describe('Override decomposition strategy. Omit to let the orchestrator decide.'),
  },
  async ({ task, strategy }) => {
    await boot();
    await syncWorkersViaKeychain();

    try {
      const { TaskDispatcher, AgentRegistry } = await import('@gossip/orchestrator');

      // Build registry from current agents
      const { findConfigPath, loadConfig, configToAgentConfigs } = await import('./config');
      const configPath = findConfigPath();
      if (!configPath) return { content: [{ type: 'text' as const, text: 'No config found. Run gossip_setup first.' }] };

      const config = loadConfig(configPath);
      const agentConfigs = configToAgentConfigs(config);
      const registry = new AgentRegistry();
      for (const ac of agentConfigs) registry.register(ac);

      // Use main agent's LLM for planning
      const mainKey = await keychain.getKey(config.main_agent.provider);
      const { createProvider } = await import('@gossip/orchestrator');
      const llm = createProvider(config.main_agent.provider, config.main_agent.model, mainKey ?? undefined);

      const dispatcher = new TaskDispatcher(llm, registry);

      // 1. Decompose
      const plan = await dispatcher.decompose(task);
      if (strategy) plan.strategy = strategy;

      // 2. Assign agents
      dispatcher.assignAgents(plan);

      // 3. Classify write modes
      const planned = await dispatcher.classifyWriteModes(plan);

      // 4. Build response
      const taskLines = planned.map((t, i) => {
        const tag = t.access === 'write' ? '[WRITE]' : '[READ]';
        let line = `  ${i + 1}. ${tag} ${t.agentId || 'unassigned'} → "${t.task}"`;
        if (t.writeMode) {
          line += `\n     write_mode: ${t.writeMode}`;
          if (t.scope) line += ` | scope: ${t.scope}`;
        }
        return line;
      }).join('\n');

      const planJson = {
        strategy: plan.strategy,
        tasks: planned.map(t => {
          const entry: Record<string, string> = { agent_id: t.agentId, task: t.task };
          if (t.writeMode) entry.write_mode = t.writeMode;
          if (t.scope) entry.scope = t.scope;
          return entry;
        }),
      };

      let warnings = '';
      if (plan.warnings?.length) {
        warnings = `\nWarnings:\n${plan.warnings.map(w => `  - ${w}`).join('\n')}\n`;
      }

      const unassigned = planned.filter(t => !t.agentId);
      if (unassigned.length) {
        warnings += `\nUnassigned tasks (no matching agent): ${unassigned.length}\n`;
      }

      const text = `Plan: "${task}"

Strategy: ${plan.strategy}

Tasks:
${taskLines}
${warnings}
---
PLAN_JSON:
${JSON.stringify(planJson)}`;

      return { content: [{ type: 'text' as const, text }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Plan error: ${err.message}` }] };
    }
  }
);
```

- [ ] **Step 2: Verify build**

Run: `npx jest --config jest.config.base.js --verbose`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(mcp): add gossip_plan tool for write-mode-aware task planning"
```

---

### Task 4: Update tool descriptions

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Update gossip_dispatch description**

Change the `gossip_dispatch` tool description (around line 180) from:
```
'Send a task to a specific agent. Returns task ID for collecting results. Skills are auto-injected from the agent config — no need to pass them. The agent can read files itself via the Tool Server — pass file paths in the task, not file contents.'
```

To:
```
'Send a task to a specific agent. Returns task ID for collecting results. For implementation tasks that modify files, use gossip_plan first to get a write-mode-aware dispatch plan, or pass write_mode explicitly. Without write_mode, agents can only read files. Skills are auto-injected — pass file paths in the task, not contents.'
```

- [ ] **Step 2: Update gossip_dispatch_parallel description**

Change the `gossip_dispatch_parallel` description from:
```
'Fan out tasks to multiple agents simultaneously. Skills are auto-injected. Agents read files via Tool Server.'
```

To:
```
'Fan out tasks to multiple agents simultaneously. For tasks involving file modifications, use gossip_plan first to get a pre-built task array with write modes, then pass it here. The PLAN_JSON from gossip_plan is directly passable as the tasks parameter.'
```

- [ ] **Step 3: Add gossip_plan to gossip_tools listing**

In the `gossip_tools` handler, add to the tools array:
```typescript
{ name: 'gossip_plan', desc: 'Plan a task with write-mode suggestions. Returns dispatch-ready JSON for approval before execution.' },
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(mcp): update tool descriptions to reference gossip_plan for write tasks"
```

---

### Task 5: Update bootstrap prompt

**Files:**
- Modify: `packages/orchestrator/src/bootstrap.ts`

- [ ] **Step 1: Add write modes section to renderTeamPrompt**

In `packages/orchestrator/src/bootstrap.ts`, in the `renderTeamPrompt` method, add a write modes section after the "Dispatch Rules" section. Find the line containing `## Memory` and insert before it:

```typescript
## Write Modes

Agents can modify files when dispatched with a write mode:
- \`sequential\` — one write task at a time (safe default for implementation)
- \`scoped\` — parallel writes locked to non-overlapping directories
- \`worktree\` — fully isolated git branch per task

**Workflow for implementation tasks:**
1. Call \`gossip_plan(task)\` to get a decomposed plan with write-mode suggestions
2. Review the plan — adjust write modes or agents if needed
3. Call \`gossip_dispatch_parallel\` with the plan's task array to execute

For read-only tasks (reviews, analysis), use \`gossip_dispatch\` or \`gossip_orchestrate\` directly — no write mode needed.
```

Also add `gossip_plan` to the Tools table:
```
| \`gossip_plan(task)\` | Plan task with write-mode suggestions. Returns dispatch-ready JSON. |
```

- [ ] **Step 2: Regenerate bootstrap**

After editing, the bootstrap will be regenerated on next `gossip_bootstrap()` call. No manual action needed.

- [ ] **Step 3: Verify build**

Run: `npx jest --config jest.config.base.js tests/orchestrator/ --verbose`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/bootstrap.ts
git commit -m "feat(bootstrap): add write modes section and gossip_plan to generated prompt"
```

---

### Task 6: Build MCP + full regression

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --config jest.config.base.js --verbose`
Expected: All tests pass

- [ ] **Step 2: Build MCP**

Run: `npx esbuild apps/cli/src/mcp-server-sdk.ts --bundle --platform=node --target=node18 --outfile=dist-mcp/mcp-server.js --external:@modelcontextprotocol/sdk --format=esm`
Expected: Clean build

- [ ] **Step 3: Reconnect MCP and smoke test**

After `/mcp` reconnect:
```
gossip_plan(task: "fix the scope validation bug in packages/tools/")
```
Verify response contains:
- Human-readable summary with [WRITE]/[READ] tags
- PLAN_JSON block with valid JSON
- Suggested write_mode and scope for the implementation task

- [ ] **Step 4: Verify gossip_tools shows new tool**

```
gossip_tools()
```
Verify `gossip_plan` appears in the listing.
