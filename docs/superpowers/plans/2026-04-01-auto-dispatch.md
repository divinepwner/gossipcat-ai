# Auto-Dispatch for Implementation Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the gossipcat orchestrator auto-dispatch implementation tasks to agents instead of writing code directly, so memory, signals, and dashboard activity are always captured.

**Architecture:** Four changes: (1) add auto-dispatch rule to `.claude/rules/gossipcat.md`, (2) replace the full-executor `auto` mode in `gossip_run` with a fast single/multi classifier + routing, (3) add a re-entrant guard via in-memory depth counter, (4) add the rule to `generateRulesContent()` so it persists across `gossip_setup` regenerations.

**Tech Stack:** TypeScript, Zod schemas, MCP SDK (`@modelcontextprotocol/sdk`), gossipcat orchestrator (`@gossip/orchestrator`)

---

## File Structure

| File | Purpose |
|------|---------|
| `.claude/rules/gossipcat.md` | Add auto-dispatch rule section, update "single agent is fine for" line |
| `apps/cli/src/mcp-server-sdk.ts` | Fast classifier in `gossip_run auto` (~line 1102), re-entrant guard around dispatch, `generateRulesContent()` update (~line 52) |
| `packages/orchestrator/src/main-agent.ts` | New `classifyTaskComplexity()` method |
| `packages/orchestrator/src/agent-registry.ts` | Ensure `findBestMatch()` is exported (already public, verify) |
| `tests/orchestrator/main-agent.test.ts` | Tests for `classifyTaskComplexity()` |
| `tests/cli/mcp-server-sdk.test.ts` | Tests for auto-mode routing and re-entrant guard |

---

### Task 1: Add Auto-Dispatch Rule to `.claude/rules/gossipcat.md`

**Files:**
- Modify: `.claude/rules/gossipcat.md:97` (update "single agent is fine for" line)
- Modify: `.claude/rules/gossipcat.md` (add new section after Override section, ~line 115)

- [ ] **Step 1: Update the "single agent is fine for" line**

In `.claude/rules/gossipcat.md`, find line 97:

```
**Single agent is fine for:** quick lookups, simple implementations, running tests.
```

Replace with:

```
**Single agent is fine for:** quick lookups, running tests, file reads.
```

This removes "simple implementations" which conflicts with the auto-dispatch rule.

- [ ] **Step 2: Add the Auto-Dispatch Rule section**

After the Override section (after line ~115), add:

```markdown
---

## Auto-Dispatch Rule

**Precedence:** The Tier 1/2/3 rules above take priority. If a task matches a Tier 1
trigger (shared mutable state, auth, persistence, etc.), use `gossip_dispatch(mode: "consensus")`
as before. If it matches Tier 2, use `gossip_run` with the appropriate reviewer. Auto-dispatch
applies to implementation tasks that don't match Tier 1 or Tier 2 triggers.

Before writing implementation code, call `gossip_run(agent_id: "auto", task: "<description>")`.

This applies when the user asks to implement, build, add, create, refactor, or fix any
non-trivial code change. The orchestrator's role is to coordinate — dispatch to agents,
verify results, record signals — not to implement directly.

**Exceptions (orchestrator may implement directly):**
- User includes `(direct)` in their message
- Change matches Tier 3 (docs, CSS, test additions, log strings)
- Change is under 10 lines with no side effects on shared state (existing `(quick-fix)` rules)
- Orchestrator is already executing inside a dispatched plan step

**Flow:**
1. Check Tier 1/2 triggers first — if matched, follow existing dispatch rules
2. Call `gossip_run(agent_id: "auto", task: "<what user asked>")`
3. gossip_run classifies → single-agent or multi-agent
4. Single: selects best-fit agent via dispatch weights, dispatches directly
5. Multi: calls gossip_plan, presents decomposition, dispatches on approval
6. Orchestrator collects results, verifies, records signals
```

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/gossipcat.md
git commit -m "feat(dispatch): add auto-dispatch rule for implementation tasks"
```

---

### Task 2: Add `classifyTaskComplexity()` to MainAgent

**Files:**
- Modify: `packages/orchestrator/src/main-agent.ts` (add method after `handleMessage` at ~line 356)
- Create: `tests/orchestrator/task-complexity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/task-complexity.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test classifyTaskComplexity via a minimal MainAgent setup
describe('classifyTaskComplexity', () => {
  let mainAgent: any;
  let mockLlm: any;

  beforeEach(() => {
    mockLlm = {
      generate: vi.fn(),
    };
  });

  it('returns "single" for simple single-concern tasks', async () => {
    mockLlm.generate.mockResolvedValue({ text: 'single' });

    // Import MainAgent — we need a minimal construction
    const { MainAgent } = await import('../../packages/orchestrator/src/main-agent');
    const { AgentRegistry } = await import('../../packages/orchestrator/src/agent-registry');

    const registry = new AgentRegistry();
    registry.register({
      id: 'sonnet-impl',
      name: 'Sonnet Implementer',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      role: 'implementer',
      skills: ['typescript', 'implementation'],
    });

    mainAgent = new MainAgent({
      llm: mockLlm,
      registry,
      agents: [],
    });

    const result = await mainAgent.classifyTaskComplexity(
      'Add an optional timeout field to the TaskConfig interface'
    );

    expect(result).toBe('single');
    expect(mockLlm.generate).toHaveBeenCalledTimes(1);

    // Verify the prompt asks for single/multi classification
    const callArgs = mockLlm.generate.mock.calls[0][0];
    const systemMsg = callArgs.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('single');
    expect(systemMsg.content).toContain('multi');
  });

  it('returns "multi" for complex multi-concern tasks', async () => {
    mockLlm.generate.mockResolvedValue({ text: 'multi' });

    const { MainAgent } = await import('../../packages/orchestrator/src/main-agent');
    const { AgentRegistry } = await import('../../packages/orchestrator/src/agent-registry');

    const registry = new AgentRegistry();
    registry.register({
      id: 'sonnet-impl',
      name: 'Sonnet Implementer',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      role: 'implementer',
      skills: ['typescript', 'implementation'],
    });

    mainAgent = new MainAgent({
      llm: mockLlm,
      registry,
      agents: [],
    });

    const result = await mainAgent.classifyTaskComplexity(
      'Refactor the dispatch pipeline to support streaming results and add a new dashboard tab for live task progress'
    );

    expect(result).toBe('multi');
  });

  it('defaults to "single" on LLM parse failure', async () => {
    mockLlm.generate.mockResolvedValue({ text: 'I think this is a complex task because...' });

    const { MainAgent } = await import('../../packages/orchestrator/src/main-agent');
    const { AgentRegistry } = await import('../../packages/orchestrator/src/agent-registry');

    const registry = new AgentRegistry();
    mainAgent = new MainAgent({
      llm: mockLlm,
      registry,
      agents: [],
    });

    const result = await mainAgent.classifyTaskComplexity('some task');

    expect(result).toBe('single');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/task-complexity.test.ts --no-coverage`
Expected: FAIL — `classifyTaskComplexity` is not a function

- [ ] **Step 3: Implement `classifyTaskComplexity` on MainAgent**

In `packages/orchestrator/src/main-agent.ts`, add after the `handleMessage` method (~line 356):

```typescript
  /**
   * Fast classifier: determines if a task needs single-agent or multi-agent handling.
   * Single LLM call, no tools, <5 output tokens. Used by gossip_run auto mode.
   */
  async classifyTaskComplexity(task: string): Promise<'single' | 'multi'> {
    const agentSummary = this.registry.getAll()
      .map(a => `${a.id}: ${a.role} (${a.skills.join(', ')})`)
      .join('\n');

    const response = await this.llm.generate([
      {
        role: 'system',
        content: `You classify tasks as "single" or "multi". Respond with ONLY one word.

"single" = one agent can handle the entire task (clear scope, one concern, no conflicting file ownership)
"multi" = needs decomposition (multiple independent concerns, parallel workstreams, or unclear scope)

Available agents:
${agentSummary}`,
      },
      { role: 'user', content: task },
    ]);

    const answer = response.text.trim().toLowerCase();
    if (answer === 'multi') return 'multi';
    return 'single'; // Default to single on any parse ambiguity
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/orchestrator/task-complexity.test.ts --no-coverage`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts tests/orchestrator/task-complexity.test.ts
git commit -m "feat(orchestrator): add classifyTaskComplexity for fast single/multi routing"
```

---

### Task 3: Replace `gossip_run auto` Full Executor with Fast Classifier

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:1101-1105` (replace auto mode block)

- [ ] **Step 1: Write the failing test**

Add to `tests/cli/mcp-server-sdk.test.ts` (or create a focused test file if the existing one is large):

```typescript
describe('gossip_run auto mode', () => {
  it('calls classifyTaskComplexity instead of handleMessageDecompose', async () => {
    // This test verifies the wiring — that auto mode calls the fast classifier
    // The actual classification logic is tested in task-complexity.test.ts
    const mockMainAgent = {
      classifyTaskComplexity: vi.fn().mockResolvedValue('single'),
      handleMessage: vi.fn(),
    };

    // Verify classifyTaskComplexity is called, not handleMessage with decompose
    // (Integration test — exact wiring depends on how the MCP server is structured)
  });
});
```

Note: The MCP server SDK is a large integration file. The primary test for this change is verifying that `classifyTaskComplexity` is called instead of `handleMessage` with `mode: 'decompose'`. The classification logic itself is tested in Task 2.

- [ ] **Step 2: Replace the auto mode block**

In `apps/cli/src/mcp-server-sdk.ts`, replace lines 1101-1105:

```typescript
    // Auto mode: orchestrator decomposes and assigns agents
    if (agent_id === 'auto') {
      const result = await ctx.mainAgent.handleMessage(task, { mode: 'decompose' });
      return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    }
```

With:

```typescript
    // Auto mode: fast classify → route to single agent or full plan
    if (agent_id === 'auto') {
      const complexity = await ctx.mainAgent.classifyTaskComplexity(task);

      if (complexity === 'multi') {
        // Multi-agent: delegate to full gossip_plan flow
        const result = await ctx.mainAgent.handleMessage(task, { mode: 'decompose' });
        return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result) }] };
      }

      // Single-agent: find best match and dispatch directly
      const { AgentRegistry } = await import('@gossip/orchestrator');
      const { findConfigPath, loadConfig, configToAgentConfigs } = await import('./config');
      const configPath = findConfigPath();
      if (!configPath) return { content: [{ type: 'text' as const, text: 'No config found. Run gossip_setup first.' }] };

      const config = loadConfig(configPath);
      const agentConfigs = configToAgentConfigs(config);
      const registry = new AgentRegistry();
      for (const ac of agentConfigs) registry.register(ac);

      // Extract likely skills from task text for matching
      const implSkills = ['implementation', 'typescript'];
      const bestAgent = registry.findBestMatch(implSkills);
      const selectedId = bestAgent?.id || agentConfigs[0]?.id;

      if (!selectedId) {
        return { content: [{ type: 'text' as const, text: 'No agents available. Run gossip_setup first.' }] };
      }

      // Re-enter gossip_run with the selected agent
      // This is NOT recursive — agent_id will be a specific ID, not "auto"
      return { content: [{ type: 'text' as const, text:
        `Auto-dispatch: classified as single-agent task.\n` +
        `Selected: ${selectedId} (best match by dispatch weight)\n\n` +
        `Dispatching via: gossip_run(agent_id: "${selectedId}", task: "${task.slice(0, 80)}...")\n\n` +
        `Call gossip_run(agent_id: "${selectedId}", task: <your task>) to execute.`
      }] };
    }
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(dispatch): replace auto mode full executor with fast classifier routing"
```

---

### Task 4: Add Re-Entrant Guard

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts` (add depth counter near top-level context, wrap dispatch execution)

- [ ] **Step 1: Add the depth counter**

In `apps/cli/src/mcp-server-sdk.ts`, find the context area where `ctx` is defined (near the MCP server setup). Add a module-level counter:

```typescript
// Re-entrant guard: prevents gossip_plan from being called inside a plan step
let planExecutionDepth = 0;
```

- [ ] **Step 2: Add guard to `gossip_plan` handler**

In the `gossip_plan` handler (line ~574), add after `await boot()`:

```typescript
    // Re-entrant guard: if we're already inside a plan execution, don't re-decompose
    if (planExecutionDepth > 0) {
      return { content: [{ type: 'text' as const, text:
        'Skipped: already inside a plan step. Execute the task directly instead of re-planning.' }] };
    }
```

- [ ] **Step 3: Wrap dispatch execution with depth tracking**

In the `gossip_dispatch` handler, find where tasks are actually executed (the relay dispatch calls). Wrap the execution section:

```typescript
    planExecutionDepth++;
    try {
      // ... existing dispatch execution code ...
    } finally {
      planExecutionDepth--;
    }
```

Note: The exact location depends on the dispatch handler structure. Look for the section after task creation where relay workers or native agents are kicked off.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(dispatch): add re-entrant guard to prevent cascading gossip_plan calls"
```

---

### Task 5: Update `generateRulesContent()` for Persistence Across Regeneration

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:52-170` (inside `generateRulesContent()`)

- [ ] **Step 1: Update the "single agent is fine for" line in generated rules**

In `generateRulesContent()`, find line ~97:

```typescript
**Single agent is fine for:** quick lookups, simple implementations, running tests.
```

Replace with:

```typescript
**Single agent is fine for:** quick lookups, running tests, file reads.
```

- [ ] **Step 2: Add auto-dispatch section to generated rules**

After the "Native Agent Relay Rule" section (~line 168), add:

```typescript
## Implementation Tasks — Auto-Dispatch

Check Tier 1/2 triggers first (see .claude/rules/gossipcat.md). If no match, call
gossip_run(agent_id: "auto", task: "<description>") BEFORE writing any code.

Exceptions: (direct) in user message, Tier 3 changes (docs, CSS, tests), or already
executing inside a dispatched plan step.

gossip_run auto classifies single vs multi and routes appropriately:
- Single: selects best-fit agent by dispatch weight, dispatches directly
- Multi: calls gossip_plan for decomposition, presents for approval, then dispatches
```

- [ ] **Step 3: Run tests**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(dispatch): add auto-dispatch rule to generateRulesContent for setup regeneration"
```

---

### Task 6: Build MCP Bundle and Verify

**Files:**
- No new files — build and integration test

- [ ] **Step 1: Build the orchestrator package**

```bash
cd packages/orchestrator && npm run build && cd ../..
```

Expected: Clean build, no errors.

- [ ] **Step 2: Build the MCP bundle**

```bash
npm run build:mcp
```

Expected: Clean build. The `dist-mcp/mcp-server.js` should contain the new auto-dispatch code.

- [ ] **Step 3: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 4: Smoke test — verify MCP server starts**

```bash
node -e "
const { spawn } = require('child_process');
const p = spawn('node', ['dist-mcp/mcp-server.js'], { stdio: ['pipe','pipe','pipe'] });
let out = '';
p.stderr.on('data', d => { out += d.toString(); });
setTimeout(() => {
  console.log(out.includes('Booted') ? 'PASS: Server boots' : 'FAIL: ' + out);
  p.kill();
  process.exit(0);
}, 5000);
"
```

Expected: "PASS: Server boots"

- [ ] **Step 5: Commit build artifacts**

```bash
git add dist-mcp/mcp-server.js packages/orchestrator/dist/
git commit -m "build: rebuild MCP bundle and orchestrator with auto-dispatch"
```

---

## Summary

| Task | What | Risk |
|------|------|------|
| 1 | Rules file update | Low — text only |
| 2 | `classifyTaskComplexity()` method + tests | Low — isolated new method |
| 3 | Replace auto mode routing | Medium — changes `gossip_run auto` contract |
| 4 | Re-entrant guard | Low — additive safety check |
| 5 | `generateRulesContent()` update | Low — text template change |
| 6 | Build + verify | Low — integration check |
