# Cognitive Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MainAgent's rigid decompose→dispatch flow with LLM-powered intent detection and tool calling, so natural language in the interactive chat automatically maps to the right pipeline action.

**Architecture:** The MainAgent's `handleMessage()` gains a `cognitive` mode where it calls the LLM with tool definitions in the system prompt. The LLM responds with either plain text (chat) or a `[TOOL_CALL]` block (action). A `ToolRouter` parses, validates, and executes tool calls with auto-chaining (e.g., dispatch→collect). The old decompose flow is preserved as `decompose` mode for `gossip_orchestrate`.

**Tech Stack:** TypeScript, Jest, existing `ILLMProvider` abstraction, existing `DispatchPipeline`

**Spec:** `docs/superpowers/specs/2026-03-24-cognitive-orchestration-design.md`

---

## Decisions from spec review

1. Text-based `[TOOL_CALL]` blocks (not native function calling) for provider agnosticism
2. Auto-chaining: LLM expresses intent, orchestrator handles dispatch→collect mechanics
3. Single-turn: one tool call per `handleMessage()` invocation
4. `handleMessage(mode: 'cognitive' | 'decompose')` — cognitive for chat, decompose for MCP
5. 10-turn sliding window conversation history, ephemeral per session
6. `[TOOL_CALL]` takes precedence over `[CHOICES]` — mutually exclusive parse paths
7. All `agent_id` params validated against registry before I/O
8. Plan choice values are constants, not LLM-generated strings
9. `update_instructions` requires user confirmation via `[CHOICES]`
10. Spec file paths sandboxed within `projectRoot`

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/types.ts` | **Modify** | Add `ToolCall`, `ToolResult`, `HandleMessageOptions` |
| `packages/orchestrator/src/tool-definitions.ts` | **Create** | Tool schemas, system prompt builder, plan choice constants |
| `packages/orchestrator/src/tool-router.ts` | **Create** | Parse `[TOOL_CALL]`, validate, execute with auto-chaining |
| `packages/orchestrator/src/main-agent.ts` | **Modify** | Add cognitive mode, conversation history, pendingPlan |
| `packages/orchestrator/src/prompt-assembler.ts` | **Modify** | Add spec-review enrichment |
| `packages/orchestrator/src/index.ts` | **Modify** | Export new modules |
| `tests/orchestrator/tool-definitions.test.ts` | **Create** | Schema validation, prompt builder |
| `tests/orchestrator/tool-router.test.ts` | **Create** | Parser, validator, auto-chain logic |
| `tests/orchestrator/cognitive-orchestration.test.ts` | **Create** | Integration: handleMessage cognitive mode |
| `tests/orchestrator/spec-review-enrichment.test.ts` | **Create** | File reference extraction |

---

## Task 1: Types

**Files:**
- Modify: `packages/orchestrator/src/types.ts`
- Test: `tests/orchestrator/tool-router.test.ts` (type import validation)

- [ ] **Step 1: Add ToolCall, ToolResult, HandleMessageOptions types**

```typescript
// Append to packages/orchestrator/src/types.ts

/** A parsed tool call from LLM response */
export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** Result of executing a tool via ToolRouter */
export interface ToolResult {
  text: string;
  agents?: string[];
  choices?: ChatResponse['choices'];
}

/** Options for MainAgent.handleMessage() */
export interface HandleMessageOptions {
  /** 'cognitive' = intent detection (default), 'decompose' = old flow */
  mode?: 'cognitive' | 'decompose';
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc -b 2>&1 | head -10`
Expected: No errors related to new types

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/types.ts
git commit -m "feat(types): add ToolCall, ToolResult, HandleMessageOptions for cognitive orchestration"
```

---

## Task 2: Tool definitions and system prompt builder

**Files:**
- Create: `packages/orchestrator/src/tool-definitions.ts`
- Create: `tests/orchestrator/tool-definitions.test.ts`

- [ ] **Step 1: Write failing tests for tool definitions**

```typescript
// tests/orchestrator/tool-definitions.test.ts
import { TOOL_SCHEMAS, PLAN_CHOICES, buildToolSystemPrompt } from '../../packages/orchestrator/src/tool-definitions';

describe('Tool Definitions', () => {
  it('should have schemas for all tools', () => {
    const expectedTools = [
      'dispatch', 'dispatch_parallel', 'dispatch_consensus',
      'plan', 'agents', 'agent_status', 'agent_performance',
      'update_instructions', 'read_task_history',
    ];
    for (const tool of expectedTools) {
      expect(TOOL_SCHEMAS[tool]).toBeDefined();
      expect(TOOL_SCHEMAS[tool].description).toBeTruthy();
      expect(TOOL_SCHEMAS[tool].requiredArgs).toBeDefined();
    }
  });

  it('should not include a chat tool', () => {
    expect(TOOL_SCHEMAS['chat']).toBeUndefined();
  });

  it('should define plan choice constants', () => {
    expect(PLAN_CHOICES.EXECUTE).toBe('plan_execute');
    expect(PLAN_CHOICES.MODIFY).toBe('plan_modify');
    expect(PLAN_CHOICES.CANCEL).toBe('plan_cancel');
  });

  it('should build a system prompt with agent list', () => {
    const agents = [
      { id: 'reviewer', preset: 'reviewer', skills: ['code_review'] },
      { id: 'tester', preset: 'tester', skills: ['testing'] },
    ];
    const prompt = buildToolSystemPrompt(agents);
    expect(prompt).toContain('dispatch(');
    expect(prompt).toContain('dispatch_consensus(');
    expect(prompt).toContain('[TOOL_CALL]');
    expect(prompt).toContain('reviewer');
    expect(prompt).toContain('tester');
    // Should NOT duplicate the agent list — references bootstrap
    expect(prompt).toContain('See the team context above');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/tool-definitions.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tool-definitions.ts**

```typescript
// packages/orchestrator/src/tool-definitions.ts

export interface ToolSchema {
  description: string;
  requiredArgs: string[];
  optionalArgs?: string[];
}

export const TOOL_SCHEMAS: Record<string, ToolSchema> = {
  dispatch: {
    description: 'Send a task to one specific agent',
    requiredArgs: ['agent_id', 'task'],
  },
  dispatch_parallel: {
    description: 'Send tasks to multiple agents simultaneously',
    requiredArgs: ['tasks'],
  },
  dispatch_consensus: {
    description: 'Dispatch to all agents with consensus cross-review',
    requiredArgs: ['task'],
    optionalArgs: ['agent_ids'],
  },
  plan: {
    description: 'Decompose a task into sub-tasks with write-mode classification',
    requiredArgs: ['task'],
  },
  agents: {
    description: 'List configured agents with skills and status',
    requiredArgs: [],
  },
  agent_status: {
    description: 'Show recent task history for an agent',
    requiredArgs: ['agent_id'],
  },
  agent_performance: {
    description: 'Show consensus signals and performance trends',
    requiredArgs: [],
  },
  update_instructions: {
    description: 'Update agent instructions (requires confirmation)',
    requiredArgs: ['agent_ids', 'instruction'],
    optionalArgs: ['mode'],
  },
  read_task_history: {
    description: 'Read recent task entries from agent memory',
    requiredArgs: ['agent_id'],
    optionalArgs: ['limit'],
  },
};

export const PLAN_CHOICES = {
  EXECUTE: 'plan_execute',
  MODIFY: 'plan_modify',
  CANCEL: 'plan_cancel',
} as const;

export const PENDING_PLAN_CHOICES = {
  DISCARD: 'discard_and_replan',
  EXECUTE_PENDING: 'execute_pending',
  CANCEL: 'cancel',
} as const;

export function buildToolSystemPrompt(
  agents: Array<{ id: string; preset?: string; skills: string[] }>,
): string {
  return `You have access to orchestration tools. When the user's message requires an action
(dispatching agents, reviewing code, checking status), call the appropriate tool.
When the message is a question or conversation, just respond directly.

Available tools:

dispatch(agent_id: string, task: string)
  Send a task to one specific agent. Use when the user names a specific agent or
  the task only needs one.

dispatch_parallel(tasks: [{agent_id: string, task: string}])
  Send tasks to multiple agents simultaneously. Use when the task benefits from
  multiple perspectives but doesn't need cross-review.

dispatch_consensus(task: string, agent_ids?: string[])
  Dispatch to all agents (or specified ones) with consensus cross-review.
  Use when the user wants thorough review, security audit, or says
  "review with all agents", "consensus", "cross-review", etc.

plan(task: string)
  Decompose a task into sub-tasks with write-mode classification.
  Use when the user wants to plan before executing, or the task involves
  file modifications that need approval.

agents()
  List configured agents with their skills and status.

agent_status(agent_id: string)
  Show recent task history and performance for an agent.

agent_performance()
  Show consensus signals and performance trends from agent-performance.jsonl.

update_instructions(agent_ids: string[], instruction: string)
  Propose an update to agent instructions. Always requires user confirmation.

read_task_history(agent_id: string, limit?: number)
  Read recent task entries from an agent's memory.

To call a tool, include a [TOOL_CALL] block:
[TOOL_CALL]
{"tool": "tool_name", "args": {...}}
[/TOOL_CALL]

If the user's message is just a question or conversation, respond normally without
a tool call. You can include text before a [TOOL_CALL] block to explain what you're doing.

If you're unsure whether the user wants a quick answer or a full agent dispatch,
present options using the [CHOICES] format.

See the team context above for available agents and their skills.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/tool-definitions.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/tool-definitions.ts tests/orchestrator/tool-definitions.test.ts
git commit -m "feat(orchestrator): add tool definitions and system prompt builder"
```

---

## Task 3: Tool router — parser and validator

**Files:**
- Create: `packages/orchestrator/src/tool-router.ts`
- Create: `tests/orchestrator/tool-router.test.ts`

- [ ] **Step 1: Write failing tests for parseToolCall**

```typescript
// tests/orchestrator/tool-router.test.ts
import { ToolRouter } from '../../packages/orchestrator/src/tool-router';

describe('ToolRouter.parseToolCall', () => {
  it('should parse a valid tool call', () => {
    const text = 'I will dispatch this.\n[TOOL_CALL]\n{"tool": "dispatch", "args": {"agent_id": "reviewer", "task": "review X"}}\n[/TOOL_CALL]';
    const result = ToolRouter.parseToolCall(text);
    expect(result).toEqual({ tool: 'dispatch', args: { agent_id: 'reviewer', task: 'review X' } });
  });

  it('should return null for plain text', () => {
    expect(ToolRouter.parseToolCall('Just a normal response.')).toBeNull();
  });

  it('should return null for unknown tool', () => {
    const text = '[TOOL_CALL]\n{"tool": "nonexistent", "args": {}}\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)).toBeNull();
  });

  it('should handle markdown code fences inside the block', () => {
    const text = '[TOOL_CALL]\n```json\n{"tool": "agents", "args": {}}\n```\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)).toEqual({ tool: 'agents', args: {} });
  });

  it('should handle trailing commas in JSON', () => {
    const text = '[TOOL_CALL]\n{"tool": "agents", "args": {},}\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)).toEqual({ tool: 'agents', args: {} });
  });

  it('should extract only the first tool call if multiple exist', () => {
    const text = '[TOOL_CALL]\n{"tool": "agents", "args": {}}\n[/TOOL_CALL]\nSome text\n[TOOL_CALL]\n{"tool": "dispatch", "args": {"agent_id": "x", "task": "y"}}\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)?.tool).toBe('agents');
  });

  it('should return null for malformed JSON', () => {
    const text = '[TOOL_CALL]\n{not valid json}\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)).toBeNull();
  });

  it('should return null for missing required args', () => {
    const text = '[TOOL_CALL]\n{"tool": "dispatch", "args": {"agent_id": "reviewer"}}\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)).toBeNull();
  });

  it('should validate agent_id format', () => {
    const text = '[TOOL_CALL]\n{"tool": "dispatch", "args": {"agent_id": "../etc/passwd", "task": "x"}}\n[/TOOL_CALL]';
    expect(ToolRouter.parseToolCall(text)).toBeNull();
  });
});

describe('ToolRouter.stripToolCallBlocks', () => {
  it('should remove all tool call blocks from text', () => {
    const text = 'Before\n[TOOL_CALL]\n{"tool":"agents","args":{}}\n[/TOOL_CALL]\nAfter';
    expect(ToolRouter.stripToolCallBlocks(text)).toBe('Before\n\nAfter');
  });

  it('should handle text with no tool call blocks', () => {
    expect(ToolRouter.stripToolCallBlocks('Just text')).toBe('Just text');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/tool-router.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ToolRouter parser and validator**

```typescript
// packages/orchestrator/src/tool-router.ts
import { ToolCall } from './types';
import { TOOL_SCHEMAS } from './tool-definitions';

const TOOL_CALL_REGEX = /\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/;
const ALL_TOOL_CALL_REGEX = /\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g;
const AGENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

const log = (msg: string) => process.stderr.write(`[tool-router] ${msg}\n`);

export class ToolRouter {
  /**
   * Parse the first [TOOL_CALL] block from LLM response text.
   * Returns null on any failure — graceful degradation to chat.
   */
  static parseToolCall(text: string): ToolCall | null {
    const match = text.match(TOOL_CALL_REGEX);
    if (!match) return null;

    let jsonStr = match[1].trim();

    // Strip markdown code fences
    const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    // Fix trailing commas (common LLM error)
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      log(`Failed to parse tool call JSON: ${jsonStr.slice(0, 200)}`);
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;

    const tool = obj.tool;
    if (typeof tool !== 'string' || !TOOL_SCHEMAS[tool]) {
      log(`Unknown or missing tool: ${tool}`);
      return null;
    }

    const args = (obj.args && typeof obj.args === 'object') ? obj.args as Record<string, unknown> : {};

    // Validate required args
    const schema = TOOL_SCHEMAS[tool];
    for (const req of schema.requiredArgs) {
      if (args[req] === undefined || args[req] === null || args[req] === '') {
        log(`Missing required arg '${req}' for tool '${tool}'`);
        return null;
      }
    }

    // Validate agent_id format if present
    if (typeof args.agent_id === 'string' && !AGENT_ID_REGEX.test(args.agent_id)) {
      log(`Invalid agent_id format: ${args.agent_id}`);
      return null;
    }
    // Validate agent_ids array if present
    if (Array.isArray(args.agent_ids)) {
      for (const id of args.agent_ids) {
        if (typeof id !== 'string' || !AGENT_ID_REGEX.test(id)) {
          log(`Invalid agent_id in array: ${id}`);
          return null;
        }
      }
    }

    return { tool, args };
  }

  /**
   * Remove all [TOOL_CALL]...[/TOOL_CALL] blocks from text.
   * Used to extract the explanation text from LLM response.
   */
  static stripToolCallBlocks(text: string): string {
    const matches = text.match(ALL_TOOL_CALL_REGEX);
    if (matches && matches.length > 1) {
      log(`Warning: ${matches.length} tool call blocks found, only first was processed`);
    }
    return text.replace(ALL_TOOL_CALL_REGEX, '').replace(/\n{3,}/g, '\n\n').trim();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/tool-router.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/tool-router.ts tests/orchestrator/tool-router.test.ts
git commit -m "feat(orchestrator): add ToolRouter with parser and validator"
```

---

## Task 4: Tool router — execution and auto-chaining

**Files:**
- Modify: `packages/orchestrator/src/tool-router.ts`
- Modify: `tests/orchestrator/tool-router.test.ts`

- [ ] **Step 1: Write failing tests for tool execution**

```typescript
// Append to tests/orchestrator/tool-router.test.ts

import { ToolExecutor } from '../../packages/orchestrator/src/tool-router';
import { ToolResult } from '../../packages/orchestrator/src/types';

describe('ToolExecutor', () => {
  const mockPipeline = {
    dispatch: jest.fn().mockReturnValue({ taskId: 'task-1', promise: Promise.resolve('done') }),
    dispatchParallel: jest.fn().mockResolvedValue({ taskIds: ['t1', 't2'], errors: [] }),
    collect: jest.fn().mockResolvedValue({ results: [{ id: 't1', agentId: 'reviewer', status: 'completed', result: 'looks good', startedAt: 1, completedAt: 2 }], consensus: undefined }),
  };
  const mockRegistry = {
    getAll: jest.fn().mockReturnValue([
      { id: 'reviewer', preset: 'reviewer', skills: ['code_review'] },
      { id: 'tester', preset: 'tester', skills: ['testing'] },
    ]),
    get: jest.fn().mockImplementation((id: string) =>
      id === 'reviewer' ? { id: 'reviewer', preset: 'reviewer', skills: ['code_review'] } :
      id === 'tester' ? { id: 'tester', preset: 'tester', skills: ['testing'] } : undefined
    ),
  };
  const mockProjectRoot = '/tmp/test-project';

  let executor: ToolExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new ToolExecutor({
      pipeline: mockPipeline as any,
      registry: mockRegistry as any,
      projectRoot: mockProjectRoot,
    });
  });

  it('should execute dispatch tool with auto-chain collect', async () => {
    const result = await executor.execute({ tool: 'dispatch', args: { agent_id: 'reviewer', task: 'review X' } });
    expect(mockPipeline.dispatch).toHaveBeenCalledWith('reviewer', 'review X');
    expect(mockPipeline.collect).toHaveBeenCalledWith(['task-1'], 120000);
    expect(result.text).toContain('looks good');
  });

  it('should execute agents tool', async () => {
    const result = await executor.execute({ tool: 'agents', args: {} });
    expect(result.text).toContain('reviewer');
    expect(result.text).toContain('tester');
  });

  it('should reject dispatch to unknown agent', async () => {
    mockRegistry.get.mockReturnValueOnce(undefined);
    const result = await executor.execute({ tool: 'dispatch', args: { agent_id: 'nonexistent', task: 'x' } });
    expect(result.text).toContain('Unknown agent');
    expect(mockPipeline.dispatch).not.toHaveBeenCalled();
  });

  it('should execute dispatch_consensus with all agents', async () => {
    await executor.execute({ tool: 'dispatch_consensus', args: { task: 'security review' } });
    expect(mockPipeline.dispatchParallel).toHaveBeenCalled();
    const callArgs = mockPipeline.dispatchParallel.mock.calls[0];
    expect(callArgs[0]).toHaveLength(2); // all agents
    expect(callArgs[1]).toEqual({ consensus: true });
  });

  it('should return error text when pipeline throws', async () => {
    mockPipeline.dispatch.mockImplementationOnce(() => { throw new Error('relay down'); });
    const result = await executor.execute({ tool: 'dispatch', args: { agent_id: 'reviewer', task: 'x' } });
    expect(result.text).toContain('relay down');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/tool-router.test.ts -v`
Expected: FAIL — ToolExecutor not found

- [ ] **Step 3: Implement ToolExecutor with auto-chaining**

Add to `packages/orchestrator/src/tool-router.ts`:

```typescript
import { ToolCall, ToolResult, ChatResponse, DispatchPlan, PlannedTask } from './types';
import { TOOL_SCHEMAS, PLAN_CHOICES, PENDING_PLAN_CHOICES } from './tool-definitions';
import { DispatchPipeline } from './dispatch-pipeline';
import { AgentRegistry } from './agent-registry';
import { TaskDispatcher } from './task-dispatcher';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ToolExecutorConfig {
  pipeline: DispatchPipeline;
  registry: AgentRegistry;
  projectRoot: string;
  dispatcher?: TaskDispatcher;
  synthesize?: (task: string, results: any[]) => Promise<string>;
}

export class ToolExecutor {
  private config: ToolExecutorConfig;
  pendingPlan: { plan: DispatchPlan; tasks: PlannedTask[] } | null = null;
  pendingInstructionUpdate: { agentIds: string[]; instruction: string } | null = null;

  constructor(config: ToolExecutorConfig) {
    this.config = config;
  }

  /** Execute a pending plan — called from handleChoice when user approves */
  async executePlan(pending: { plan: DispatchPlan; tasks: PlannedTask[] }): Promise<ToolResult> {
    const { plan, tasks } = pending;
    const assignedTasks = tasks.filter(t => t.agentId);
    if (assignedTasks.length === 0) {
      return { text: 'No tasks could be assigned to agents.' };
    }

    const taskDefs = assignedTasks.map(t => ({
      agentId: t.agentId,
      task: t.task,
      options: t.writeMode ? { writeMode: t.writeMode, scope: t.scope } : undefined,
    }));

    if (plan.strategy === 'sequential') {
      const results: string[] = [];
      for (const def of taskDefs) {
        const { taskId } = this.config.pipeline.dispatch(def.agentId, def.task, def.options);
        const { results: collected } = await this.config.pipeline.collect([taskId], 120_000);
        const r = collected[0];
        results.push(`[${def.agentId}]: ${r?.status === 'completed' ? r.result : r?.error || 'failed'}`);
      }
      return { text: results.join('\n\n---\n\n'), agents: taskDefs.map(t => t.agentId) };
    }

    const { taskIds } = await this.config.pipeline.dispatchParallel(taskDefs);
    const { results } = await this.config.pipeline.collect(taskIds, 120_000);
    const texts = results.map(r =>
      `[${r.agentId}]: ${r.status === 'completed' ? r.result : r.error || 'failed'}`
    );
    return { text: texts.join('\n\n---\n\n'), agents: results.map(r => r.agentId) };
  }

  /** Apply a pending instruction update — called from handleChoice when user confirms */
  async applyInstructionUpdate(pending: { agentIds: string[]; instruction: string }): Promise<ToolResult> {
    const { writeFileSync, mkdirSync, existsSync: fileExists, readFileSync: readFs } = await import('fs');
    const { join } = await import('path');
    const applied: string[] = [];
    for (const id of pending.agentIds) {
      const dir = join(this.config.projectRoot, '.gossip', 'agents', id);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'instructions.md');
      const existing = fileExists(path) ? readFs(path, 'utf-8') : '';
      writeFileSync(path, existing + '\n\n' + pending.instruction);
      applied.push(id);
    }
    return { text: `Instructions updated for: ${applied.join(', ')}.\nNote: restart agents for changes to take effect.` };
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    try {
      switch (toolCall.tool) {
        case 'dispatch': return this.execDispatch(toolCall.args);
        case 'dispatch_parallel': return this.execDispatchParallel(toolCall.args);
        case 'dispatch_consensus': return this.execDispatchConsensus(toolCall.args);
        case 'plan': return this.execPlan(toolCall.args);
        case 'agents': return this.execAgents();
        case 'agent_status': return this.execAgentStatus(toolCall.args);
        case 'agent_performance': return this.execAgentPerformance();
        case 'update_instructions': return this.execUpdateInstructions(toolCall.args);
        case 'read_task_history': return this.execReadTaskHistory(toolCall.args);
        default: return { text: `Unknown tool: ${toolCall.tool}` };
      }
    } catch (err) {
      return { text: `Tool error: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  }

  private async execDispatch(args: Record<string, unknown>): Promise<ToolResult> {
    const agentId = args.agent_id as string;
    const task = args.task as string;
    if (!this.config.registry.get(agentId)) {
      return { text: `Unknown agent: "${agentId}". Use /agents to see available agents.` };
    }
    const { taskId } = this.config.pipeline.dispatch(agentId, task);
    const { results } = await this.config.pipeline.collect([taskId], 120_000);
    const r = results[0];
    if (r?.status === 'completed') {
      return { text: r.result || '', agents: [agentId] };
    }
    return { text: `Agent ${agentId} failed: ${r?.error || 'unknown'}`, agents: [agentId] };
  }

  private async execDispatchParallel(args: Record<string, unknown>): Promise<ToolResult> {
    const tasks = args.tasks as Array<{ agent_id: string; task: string }>;
    // Validate all agent IDs against registry
    for (const t of tasks) {
      if (!this.config.registry.get(t.agent_id)) {
        return { text: `Unknown agent: "${t.agent_id}". Use /agents to see available agents.` };
      }
    }
    const taskDefs = tasks.map(t => ({ agentId: t.agent_id, task: t.task }));
    const { taskIds, errors } = await this.config.pipeline.dispatchParallel(taskDefs);
    if (taskIds.length === 0) {
      return { text: `All dispatches failed: ${errors.join(', ')}` };
    }
    const { results } = await this.config.pipeline.collect(taskIds, 120_000);
    const texts = results.map(r => {
      if (r.status === 'completed') return `[${r.agentId}]: ${r.result}`;
      return `[${r.agentId}]: ERROR: ${r.error}`;
    });
    return { text: texts.join('\n\n---\n\n'), agents: results.map(r => r.agentId) };
  }

  private async execDispatchConsensus(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task as string;
    const agentIds = args.agent_ids as string[] | undefined;
    const allAgents = this.config.registry.getAll();
    const agents = agentIds
      ? allAgents.filter(a => agentIds.includes(a.id))
      : allAgents;

    if (agents.length < 2) {
      return { text: `Need ≥2 agents for consensus. Available: ${agents.length}` };
    }

    const taskDefs = agents.map(a => ({ agentId: a.id, task }));
    const { taskIds, errors } = await this.config.pipeline.dispatchParallel(taskDefs, { consensus: true });
    if (taskIds.length < 2) {
      return { text: `Only ${taskIds.length} agent(s) dispatched. Need ≥2 for consensus.` };
    }

    const { results, consensus } = await this.config.pipeline.collect(taskIds, 300_000, { consensus: true });
    const resultTexts = results.map(r => {
      const dur = r.completedAt ? `${r.completedAt - r.startedAt}ms` : '?';
      if (r.status === 'completed') return `[${r.agentId}] (${dur}):\n${r.result}`;
      return `[${r.agentId}]: ERROR: ${r.error}`;
    });

    let text = resultTexts.join('\n\n---\n\n');
    if (consensus) text += '\n\n' + consensus.summary;
    if (errors.length) text += `\n\nDispatch errors: ${errors.join(', ')}`;

    return { text, agents: results.map(r => r.agentId) };
  }

  private async execPlan(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task as string;
    if (!this.config.dispatcher) {
      return { text: 'Plan tool requires TaskDispatcher (not available in this context).' };
    }

    // Check for pending plan race condition
    if (this.pendingPlan) {
      return {
        text: 'You have a pending plan that hasn\'t been executed yet.',
        choices: {
          message: 'What would you like to do?',
          options: [
            { value: PENDING_PLAN_CHOICES.DISCARD, label: 'Discard old plan and create a new one' },
            { value: PENDING_PLAN_CHOICES.EXECUTE_PENDING, label: 'Execute the pending plan first' },
            { value: PENDING_PLAN_CHOICES.CANCEL, label: 'Cancel' },
          ],
        },
      };
    }

    const plan = await this.config.dispatcher.decompose(task);
    this.config.dispatcher.assignAgents(plan);
    const tasks = await this.config.dispatcher.classifyWriteModes(plan);
    this.pendingPlan = { plan, tasks };

    const taskLines = tasks.map((t, i) =>
      `${i + 1}. [${t.agentId || 'unassigned'}] ${t.task} (${t.access}${t.writeMode ? `, ${t.writeMode}` : ''})`
    ).join('\n');

    return {
      text: `Plan for: "${task}"\nStrategy: ${plan.strategy}\n\n${taskLines}`,
      choices: {
        message: 'Execute this plan?',
        options: [
          { value: PLAN_CHOICES.EXECUTE, label: 'Execute plan' },
          { value: PLAN_CHOICES.MODIFY, label: 'Let me modify it' },
          { value: PLAN_CHOICES.CANCEL, label: 'Cancel' },
        ],
      },
    };
  }

  private execAgents(): ToolResult {
    const agents = this.config.registry.getAll();
    const lines = agents.map(a =>
      `- ${a.id}: ${a.provider}/${a.model} (${a.preset || 'custom'}) — skills: ${a.skills.join(', ')}`
    );
    return { text: `Agents (${agents.length}):\n${lines.join('\n')}` };
  }

  private execAgentStatus(args: Record<string, unknown>): ToolResult {
    const agentId = args.agent_id as string;
    if (!this.config.registry.get(agentId)) {
      return { text: `Unknown agent: "${agentId}"` };
    }
    const tasksPath = join(this.config.projectRoot, '.gossip', 'agents', agentId, 'memory', 'tasks.jsonl');
    if (!existsSync(tasksPath)) {
      return { text: `No task history for ${agentId}.` };
    }
    const lines = readFileSync(tasksPath, 'utf-8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-5).map(l => {
      try { const e = JSON.parse(l); return `  - ${e.task} (${e.timestamp})`; }
      catch { return null; }
    }).filter(Boolean);
    return { text: `${agentId} — ${lines.length} tasks total\nRecent:\n${recent.join('\n')}` };
  }

  private execAgentPerformance(): ToolResult {
    const perfPath = join(this.config.projectRoot, '.gossip', 'agent-performance.jsonl');
    if (!existsSync(perfPath)) {
      return { text: 'No performance data yet. Run a consensus review first.' };
    }
    const lines = readFileSync(perfPath, 'utf-8').trim().split('\n').filter(Boolean);
    const signals = lines.slice(-20).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const summary: Record<string, { agreements: number; disagreements: number; hallucinations: number }> = {};
    for (const s of signals) {
      const id = s.agentId || 'unknown';
      if (!summary[id]) summary[id] = { agreements: 0, disagreements: 0, hallucinations: 0 };
      if (s.signal === 'agreement') summary[id].agreements++;
      else if (s.signal === 'disagreement') summary[id].disagreements++;
      else if (s.signal === 'hallucination_caught') summary[id].hallucinations++;
    }

    const text = Object.entries(summary).map(([id, s]) =>
      `${id}: ${s.agreements} agreements, ${s.disagreements} disagreements, ${s.hallucinations} hallucinations`
    ).join('\n');
    return { text: `Performance (last ${signals.length} signals):\n${text}` };
  }

  private execUpdateInstructions(args: Record<string, unknown>): ToolResult {
    const agentIds = args.agent_ids as string[];
    const instruction = args.instruction as string;

    // Validate all agent IDs first
    for (const id of agentIds) {
      if (!this.config.registry.get(id)) {
        return { text: `Unknown agent: "${id}"` };
      }
    }

    // Store for later application, always require confirmation
    this.pendingInstructionUpdate = { agentIds, instruction };
    return {
      text: `Proposed instruction update for ${agentIds.join(', ')}:\n\n"${instruction}"`,
      choices: {
        message: 'Apply this instruction update?',
        type: 'confirm',
        options: [
          { value: 'yes', label: 'Apply' },
          { value: 'no', label: 'Cancel' },
        ],
      },
    };
  }

  private execReadTaskHistory(args: Record<string, unknown>): ToolResult {
    const agentId = args.agent_id as string;
    const limit = typeof args.limit === 'number' ? args.limit : 5;
    if (!this.config.registry.get(agentId)) {
      return { text: `Unknown agent: "${agentId}"` };
    }
    const tasksPath = join(this.config.projectRoot, '.gossip', 'agents', agentId, 'memory', 'tasks.jsonl');
    if (!existsSync(tasksPath)) {
      return { text: `No task history for ${agentId}.` };
    }
    const lines = readFileSync(tasksPath, 'utf-8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-limit).map(l => {
      try {
        const e = JSON.parse(l);
        return `- [${e.timestamp}] ${e.task} (relevance: ${e.scores?.relevance}, accuracy: ${e.scores?.accuracy})`;
      } catch { return null; }
    }).filter(Boolean);
    return { text: `${agentId} — last ${recent.length} tasks:\n${recent.join('\n')}` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/tool-router.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/tool-router.ts tests/orchestrator/tool-router.test.ts
git commit -m "feat(orchestrator): add ToolExecutor with auto-chaining for all tools"
```

---

## Task 5: MainAgent cognitive mode + conversation history

**Files:**
- Modify: `packages/orchestrator/src/main-agent.ts`
- Create: `tests/orchestrator/cognitive-orchestration.test.ts`

- [ ] **Step 1: Write failing integration tests**

```typescript
// tests/orchestrator/cognitive-orchestration.test.ts
import { MainAgent } from '../../packages/orchestrator/src/main-agent';

describe('Cognitive Orchestration', () => {
  // Use a mock LLM that returns predictable responses
  const mockLlm = {
    generate: jest.fn(),
  };

  it('should return plain chat for text without tool call', async () => {
    mockLlm.generate.mockResolvedValueOnce({ text: 'The consensus engine validates findings.', usage: {} });
    // Test that handleMessage in cognitive mode returns chat response
    // (Full integration test requires MainAgent construction — will be fleshed out during implementation)
  });

  it('should detect and execute tool call', async () => {
    mockLlm.generate.mockResolvedValueOnce({
      text: 'I\'ll list the agents.\n[TOOL_CALL]\n{"tool": "agents", "args": {}}\n[/TOOL_CALL]',
      usage: {},
    });
    // Verify agents tool was executed
  });

  it('should preserve decompose mode for gossip_orchestrate', async () => {
    // handleMessage with mode: 'decompose' should use old flow
  });

  it('should maintain conversation history across calls', async () => {
    // Call handleMessage twice, verify history is passed to second LLM call
  });

  it('should handle pendingPlan approval via handleChoice', async () => {
    // Call with plan tool, then handleChoice with plan_execute
  });
});
```

- [ ] **Step 2: Modify MainAgent to support cognitive mode**

Key changes to `packages/orchestrator/src/main-agent.ts`:

1. Add `import { LLMMessage } from '@gossip/types'`
2. Add `private conversationHistory: LLMMessage[] = []`
3. Add `private toolExecutor: ToolExecutor` (initialized in constructor)
4. Add `handleMessage(userMessage, options?: HandleMessageOptions)`
5. In cognitive mode: build system prompt with tools → call LLM with conversation history → parse for `[TOOL_CALL]` → execute or return chat
6. In decompose mode: preserve existing flow exactly
7. After each call: push user + assistant to `conversationHistory`, trim to 10 pairs
8. Update `handleChoice` to check pending states:

```typescript
async handleChoice(originalMessage: string, choiceValue: string): Promise<ChatResponse> {
  // Plan approval
  if (this.toolExecutor.pendingPlan) {
    if (choiceValue === PLAN_CHOICES.EXECUTE) {
      const plan = this.toolExecutor.pendingPlan;
      this.toolExecutor.pendingPlan = null;
      const result = await this.toolExecutor.executePlan(plan);
      return { text: result.text, status: 'done', agents: result.agents };
    }
    if (choiceValue === PLAN_CHOICES.CANCEL) {
      this.toolExecutor.pendingPlan = null;
      return { text: 'Plan cancelled.', status: 'done' };
    }
    if (choiceValue === PENDING_PLAN_CHOICES.DISCARD) {
      this.toolExecutor.pendingPlan = null;
      return { text: 'Old plan discarded. Send your new task.', status: 'done' };
    }
    if (choiceValue === PENDING_PLAN_CHOICES.EXECUTE_PENDING) {
      const plan = this.toolExecutor.pendingPlan;
      this.toolExecutor.pendingPlan = null;
      const result = await this.toolExecutor.executePlan(plan);
      return { text: result.text, status: 'done', agents: result.agents };
    }
  }

  // Instruction update confirmation
  if (this.toolExecutor.pendingInstructionUpdate && choiceValue === 'yes') {
    const pending = this.toolExecutor.pendingInstructionUpdate;
    this.toolExecutor.pendingInstructionUpdate = null;
    const result = await this.toolExecutor.applyInstructionUpdate(pending);
    return { text: result.text, status: 'done' };
  }
  if (this.toolExecutor.pendingInstructionUpdate && choiceValue === 'no') {
    this.toolExecutor.pendingInstructionUpdate = null;
    return { text: 'Instruction update cancelled.', status: 'done' };
  }

  // Default: existing follow-up flow
  // ... (preserve existing handleChoice logic)
}
```

- [ ] **Step 3: Run full test suite**

Run: `npx jest --testPathIgnorePatterns="consensus-e2e|consensus-engine.security|consensus-engine.dos" -v 2>&1 | tail -20`
Expected: All tests pass (existing + new)

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts tests/orchestrator/cognitive-orchestration.test.ts
git commit -m "feat(orchestrator): add cognitive mode to handleMessage with tool calling"
```

---

## Task 6: Smart Dispatch Enrichment

**Files:**
- Modify: `packages/orchestrator/src/prompt-assembler.ts`
- Create: `tests/orchestrator/spec-review-enrichment.test.ts`

- [ ] **Step 1: Write failing tests for spec reference extraction**

```typescript
// tests/orchestrator/spec-review-enrichment.test.ts
import { extractSpecReferences, buildSpecReviewEnrichment } from '../../packages/orchestrator/src/prompt-assembler';

describe('Spec Review Enrichment', () => {
  it('should detect spec file references in task text', () => {
    const refs = extractSpecReferences('Review the spec at docs/superpowers/specs/2026-03-24-cognitive-orchestration-design.md');
    expect(refs).toContain('docs/superpowers/specs/2026-03-24-cognitive-orchestration-design.md');
  });

  it('should extract implementation file paths from spec content', () => {
    const specContent = `
| File | Action |
|------|--------|
| \`packages/orchestrator/src/main-agent.ts\` | Modify |
| \`packages/orchestrator/src/tool-router.ts\` | Create |

See also consensus-engine.ts:113 for the injection point.
    `;
    const refs = extractSpecReferences('review spec', specContent);
    expect(refs).toContain('packages/orchestrator/src/main-agent.ts');
    expect(refs).toContain('packages/orchestrator/src/tool-router.ts');
  });

  it('should build enrichment block with cross-reference instructions', () => {
    const enrichment = buildSpecReviewEnrichment([
      'packages/orchestrator/src/main-agent.ts',
      'packages/orchestrator/src/types.ts',
    ]);
    expect(enrichment).toContain('cross-reference');
    expect(enrichment).toContain('main-agent.ts');
    expect(enrichment).toContain('types.ts');
  });

  it('should return null for tasks with no spec references', () => {
    const refs = extractSpecReferences('just a regular code review task');
    expect(refs).toHaveLength(0);
  });

  it('should reject paths with .. segments', () => {
    const refs = extractSpecReferences('review ../../etc/passwd');
    expect(refs).toHaveLength(0);
  });

  it('should only accept known doc extensions', () => {
    const refs = extractSpecReferences('review docs/spec.md and also binary.exe');
    expect(refs).toContain('docs/spec.md');
    expect(refs).not.toContain('binary.exe');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/spec-review-enrichment.test.ts -v`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement enrichment functions**

Add to `packages/orchestrator/src/prompt-assembler.ts`:

```typescript
const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst']);
const SPEC_PATH_PATTERN = /(?:docs\/|specs\/|[\w-]+-(?:design|spec)\.md)/;
const FILE_REF_PATTERN = /(?:`([^`]+\.[a-z]{1,4})`|([a-zA-Z][\w/-]+\.[a-z]{1,4})(?::\d+)?)/g;

/**
 * Extract spec and implementation file references from task text and optional spec content.
 * Returns deduplicated list of file paths, validated for safety.
 */
export function extractSpecReferences(taskText: string, specContent?: string): string[] {
  const refs = new Set<string>();

  // Find spec file paths in task text
  const words = taskText.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/['"`,]/g, '');
    if (SPEC_PATH_PATTERN.test(clean) && isValidDocPath(clean)) {
      refs.add(clean);
    }
  }

  // If spec content provided, extract implementation file references
  if (specContent) {
    let match: RegExpExecArray | null;
    while ((match = FILE_REF_PATTERN.exec(specContent)) !== null) {
      const path = match[1] || match[2];
      if (path && !path.includes('..') && /\.[a-z]{1,4}$/.test(path)) {
        refs.add(path.replace(/:\d+.*$/, '')); // Strip :line suffix
      }
    }
  }

  return Array.from(refs);
}

function isValidDocPath(path: string): boolean {
  if (path.includes('..')) return false;
  const ext = '.' + path.split('.').pop();
  return DOC_EXTENSIONS.has(ext);
}

/**
 * Build the cross-reference instruction block for spec review tasks.
 */
export function buildSpecReviewEnrichment(implementationFiles: string[]): string | null {
  if (implementationFiles.length === 0) return null;

  return `\n\n--- SPEC REVIEW CONTEXT ---
IMPORTANT: This task references a spec document. You MUST cross-reference the spec's
claims against the actual implementation files listed below. Verify that:
- Described code flows match what the code actually does
- Backwards-compatibility claims are true
- Referenced functions/methods exist and work as described
- File paths and line numbers are accurate

Implementation files referenced by the spec:
${implementationFiles.map(f => `- ${f}`).join('\n')}
--- END SPEC REVIEW CONTEXT ---`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/spec-review-enrichment.test.ts -v`
Expected: PASS

- [ ] **Step 5: Wire enrichment into assemblePrompt**

Add `specReviewContext?: string` to `assemblePrompt` params and include it after the context block.

- [ ] **Step 6: Run full test suite**

Run: `npx jest --testPathIgnorePatterns="consensus-e2e|consensus-engine.security|consensus-engine.dos" -v 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/prompt-assembler.ts tests/orchestrator/spec-review-enrichment.test.ts
git commit -m "feat(orchestrator): add spec-review enrichment for cross-reference dispatch"
```

---

## Task 7: Exports and integration

**Files:**
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `apps/cli/src/mcp-server-sdk.ts` (pass `mode: 'decompose'` to gossip_orchestrate)

- [ ] **Step 1: Add exports for new modules**

```typescript
// Append to packages/orchestrator/src/index.ts
export { ToolRouter, ToolExecutor } from './tool-router';
export type { ToolExecutorConfig } from './tool-router';
export { TOOL_SCHEMAS, PLAN_CHOICES, buildToolSystemPrompt } from './tool-definitions';
export { extractSpecReferences, buildSpecReviewEnrichment } from './prompt-assembler';
```

- [ ] **Step 2: Update gossip_orchestrate to use decompose mode**

In `apps/cli/src/mcp-server-sdk.ts`, change:
```typescript
const response = await mainAgent.handleMessage(task);
```
to:
```typescript
const response = await mainAgent.handleMessage(task, { mode: 'decompose' });
```

- [ ] **Step 3: Build and verify**

Run: `npx tsc -b 2>&1 | grep -v "consensus-engine.security" | head -10`
Expected: Clean build

- [ ] **Step 4: Run full test suite**

Run: `npx jest --testPathIgnorePatterns="consensus-e2e|consensus-engine.security|consensus-engine.dos" 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 5: Rebuild MCP bundle**

Run: `npx esbuild apps/cli/src/mcp-server-sdk.ts --bundle --platform=node --target=node22 --outfile=dist-mcp/mcp-server.js --external:ws --external:@modelcontextprotocol/sdk --tsconfig=tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/index.ts apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(orchestrator): wire cognitive orchestration exports and preserve decompose mode for MCP"
```

---

## Task 8: E2E test with real LLM

**Files:**
- Create: `tests/orchestrator/cognitive-e2e.test.ts`

- [ ] **Step 1: Write E2E test**

Similar to `consensus-e2e.test.ts` — uses real Google LLM to verify intent detection works:
- Send "list agents" → verify `agents` tool is called
- Send "what is gossip mesh?" → verify plain chat response (no tool call)
- Send "security review consensus-engine.ts with all agents" → verify `dispatch_consensus` tool is called

- [ ] **Step 2: Run E2E test**

Run: `npx jest tests/orchestrator/cognitive-e2e.test.ts --testTimeout=120000 -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/cognitive-e2e.test.ts
git commit -m "test(orchestrator): add cognitive orchestration E2E test with real LLM"
```
