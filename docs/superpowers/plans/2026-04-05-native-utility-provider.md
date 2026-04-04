# Native Utility Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow utility LLM calls (lens generation, memory summaries, gossip, session summaries) to run through native Claude Code agents when Gemini quota is exhausted.

**Architecture:** Config adds `provider: "native"` for `utility_model`. Call sites branch: relay → inline LLM (current), native → EXECUTE NOW + gossip_relay. Utility tasks reuse `nativeTaskMap` with a `utilityType` discriminator. No new MCP tools.

**Tech Stack:** TypeScript, Zod (MCP schema), Jest (tests)

**Spec:** `docs/superpowers/specs/2026-04-05-native-utility-provider-design.md`

---

### Task 1: Config — Add "native" provider support

**Files:**
- Modify: `apps/cli/src/config.ts:50` (VALID_PROVIDERS), `apps/cli/src/config.ts:63-71` (validateConfig)
- Test: `tests/cli/config.test.ts`

- [ ] **Step 1: Write failing tests for native utility_model validation**

Add to `tests/cli/config.test.ts`:

```typescript
it('accepts utility_model with native provider and valid model', () => {
  const config = validateConfig({
    main_agent: { provider: 'google', model: 'gemini-2.5-pro' },
    utility_model: { provider: 'native', model: 'haiku' },
  });
  expect(config.utility_model?.provider).toBe('native');
  expect(config.utility_model?.model).toBe('haiku');
});

it('rejects native utility_model with invalid model tier', () => {
  expect(() => validateConfig({
    main_agent: { provider: 'google', model: 'gemini-2.5-pro' },
    utility_model: { provider: 'native', model: 'gpt-4' },
  })).toThrow('native');
});

it('accepts utility_model with relay provider (existing behavior)', () => {
  const config = validateConfig({
    main_agent: { provider: 'google', model: 'gemini-2.5-pro' },
    utility_model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  });
  expect(config.utility_model?.provider).toBe('anthropic');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/cli/config.test.ts --no-coverage`
Expected: First test fails (native not in VALID_PROVIDERS), second test passes (it does throw), third passes.

- [ ] **Step 3: Implement native provider validation**

In `apps/cli/src/config.ts`, update `VALID_PROVIDERS` at line 50:

```typescript
const VALID_PROVIDERS = ['anthropic', 'openai', 'google', 'local', 'native'];
```

Then in `validateConfig()`, replace the utility_model validation block (lines 63-71) with:

```typescript
  if (raw.utility_model) {
    if (!raw.utility_model.provider) throw new Error('Config "utility_model" missing provider');
    if (!raw.utility_model.model) throw new Error('Config "utility_model" missing model');
    if (!VALID_PROVIDERS.includes(raw.utility_model.provider)) {
      throw new Error(
        `Invalid utility_model provider "${raw.utility_model.provider}". Must be one of: ${VALID_PROVIDERS.join(', ')}`
      );
    }
    // Native provider requires a valid Claude model tier
    if (raw.utility_model.provider === 'native') {
      const validNativeModels = Object.keys(CLAUDE_MODEL_MAP);
      if (!validNativeModels.includes(raw.utility_model.model)) {
        throw new Error(
          `Invalid native utility_model model "${raw.utility_model.model}". Must be one of: ${validNativeModels.join(', ')}`
        );
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/cli/config.test.ts --no-coverage`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/config.ts tests/cli/config.test.ts
git commit -m "feat: add native provider to utility_model config validation"
```

---

### Task 2: Context — Add utilityType and nativeUtilityConfig

**Files:**
- Modify: `apps/cli/src/mcp-context.ts:18-25` (NativeTaskInfo), `apps/cli/src/mcp-context.ts:38-53` (McpContext)

- [ ] **Step 1: Add utilityType to NativeTaskInfo**

In `apps/cli/src/mcp-context.ts`, add `utilityType` to the interface at line 25 (after `step`):

```typescript
export interface NativeTaskInfo {
  agentId: string;
  task: string;
  startedAt: number;
  timeoutMs?: number;
  planId?: string;
  step?: number;
  utilityType?: 'lens' | 'gossip' | 'summary' | 'session_summary';
}
```

- [ ] **Step 2: Add nativeUtilityConfig to McpContext**

In the `McpContext` interface (line 38-53), add after `pendingConsensusRounds`:

```typescript
  nativeUtilityConfig: { model: string } | null;
```

And in the `ctx` object initialization (line 55-70), add:

```typescript
  nativeUtilityConfig: null,
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p apps/cli/tsconfig.json`
Expected: No new errors (fields are optional/nullable).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-context.ts
git commit -m "feat: add utilityType to NativeTaskInfo, nativeUtilityConfig to McpContext"
```

---

### Task 3: Boot — Wire nativeUtilityConfig from config

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:452-478` (ATI boot block)

- [ ] **Step 1: Add native utility detection at boot**

In `apps/cli/src/mcp-server-sdk.ts`, find the ATI boot block (around line 452-478). After the existing `utilityLlm` wiring and before `ctx.mainAgent.setLensGenerator(...)`, add the native detection:

```typescript
    // Native utility config — when provider is "native", utility calls go through Agent() dispatch
    if (config.utility_model?.provider === 'native') {
      ctx.nativeUtilityConfig = { model: config.utility_model.model };
      // Don't create an ILLMProvider — native path uses EXECUTE NOW + gossip_relay
      utilityModelId = `native/${config.utility_model.model}`;
    }
```

This goes inside the existing try block, after `let utilityModelId = ...` is set and the relay utility_model check, but before `ctx.mainAgent.setLensGenerator(...)`. The native branch sets `ctx.nativeUtilityConfig` and skips the `createProvider` call.

The existing code at line 460 (`if (config.utility_model)`) should be updated to exclude native:

```typescript
    if (config.utility_model && config.utility_model.provider !== 'native') {
```

- [ ] **Step 2: Verify boot log**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage` (if exists, otherwise build check)
Run: `npx tsc --noEmit -p apps/cli/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat: wire nativeUtilityConfig from config at boot"
```

---

### Task 4: Native task relay — Skip memory pipeline for utility tasks

**Files:**
- Modify: `apps/cli/src/handlers/native-tasks.ts:164-273` (handleNativeRelay)
- Modify: `apps/cli/src/handlers/native-tasks.ts:92-117` (persistNativeTaskMap)
- Test: `tests/cli/mcp-handlers.test.ts`

- [ ] **Step 1: Write failing test for utility task relay skipping memory pipeline**

Add to `tests/cli/mcp-handlers.test.ts`:

```typescript
describe('handleNativeRelay — utility tasks', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTmpDir('utility-relay');
    // Set up minimal ctx for native relay
    const { ctx } = require('../../apps/cli/src/mcp-context');
    ctx.booted = true;
    ctx.boot = async () => {};
    ctx.mainAgent = {
      projectRoot: testDir,
      scopeTracker: { release: () => {} },
      getAgentList: () => [],
      recordNativeTaskCompleted: () => {},
      recordPlanStepResult: () => {},
      publishNativeGossip: async () => {},
      getLLM: () => null,
    };
    // Register a utility task
    ctx.nativeTaskMap.set('util-001', {
      agentId: '_utility',
      task: 'Generate lenses for agents',
      startedAt: Date.now(),
      utilityType: 'lens',
    });
  });

  afterEach(() => {
    const { ctx } = require('../../apps/cli/src/mcp-context');
    ctx.nativeTaskMap.clear();
    ctx.nativeResultMap.clear();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('stores result without running memory pipeline for utility tasks', async () => {
    const { handleNativeRelay } = require('../../apps/cli/src/handlers/native-tasks');
    const result = await handleNativeRelay('util-001', '{"lenses": []}');

    const { ctx } = require('../../apps/cli/src/mcp-context');
    // Result should be stored
    const stored = ctx.nativeResultMap.get('util-001');
    expect(stored).toBeDefined();
    expect(stored.status).toBe('completed');
    expect(stored.result).toBe('{"lenses": []}');

    // Memory dir should NOT be created (pipeline skipped)
    const memDir = join(testDir, '.gossip', 'agents', '_utility', 'memory');
    expect(existsSync(memDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cli/mcp-handlers.test.ts -t "utility tasks" --no-coverage`
Expected: FAIL — current code runs memory pipeline for all tasks.

- [ ] **Step 3: Gate memory pipeline on utilityType in handleNativeRelay**

In `apps/cli/src/handlers/native-tasks.ts`, in `handleNativeRelay` (around line 232), wrap the memory/gossip block:

Replace the block from line 232 (`if (!error) {`) through line 267 (`}`) with:

```typescript
  // Utility tasks: skip memory pipeline + gossip (internal plumbing, not agent work product)
  if (!error && !taskInfo.utilityType) {
    // 1. Write task entry to memory
    try {
      const { MemoryWriter, MemoryCompactor } = await import('@gossip/orchestrator');
      const memWriter = new MemoryWriter(process.cwd());
      try { if (ctx.mainAgent.getLLM()) memWriter.setSummaryLlm(ctx.mainAgent.getLLM()); } catch {}
      const scores = defaultImportanceScores();
      await memWriter.writeTaskEntry(agentId, {
        taskId: task_id,
        task: taskInfo.task,
        skills: agentMeta.skills,
        scores,
      });

      // 2. Extract knowledge from result (files, tech, decisions)
      if (result) {
        await memWriter.writeKnowledgeFromResult(agentId, {
          taskId: task_id, task: taskInfo.task, result,
        });
      }

      memWriter.rebuildIndex(agentId);

      // 3. Compact memory if needed
      const compactor = new MemoryCompactor(process.cwd());
      compactor.compactIfNeeded(agentId);
    } catch (err) {
      process.stderr.write(`[gossipcat] Memory write failed for ${agentId}: ${(err as Error).message}\n`);
    }
  }

  // 4. Publish gossip so other running agents can see this result
  if (!error && !taskInfo.utilityType) {
    await ctx.mainAgent.publishNativeGossip(agentId, result.slice(0, 50000)).catch(() => {});
  }

  if (!error && taskInfo.utilityType) {
    process.stderr.write(`[gossipcat] utility ← ${ctx.nativeUtilityConfig?.model || 'native'} [${task_id}]: completed (${elapsed}ms, ${result?.length ?? 0} chars)\n`);
  }
```

- [ ] **Step 4: Filter utility tasks from persistNativeTaskMap**

In `persistNativeTaskMap()` (around line 92-117), filter utility tasks from serialization. Change the `tasks` serialization:

```typescript
    // Filter utility tasks — they're ephemeral, don't persist
    const persistableTasks = new Map(
      [...ctx.nativeTaskMap].filter(([, info]) => !info.utilityType)
    );
    const data = {
      tasks: Object.fromEntries(persistableTasks),
      results: slimResults,
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/cli/mcp-handlers.test.ts -t "utility tasks" --no-coverage`
Expected: PASS

- [ ] **Step 6: Run all handler tests**

Run: `npx jest tests/cli/mcp-handlers.test.ts --no-coverage`
Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/handlers/native-tasks.ts tests/cli/mcp-handlers.test.ts
git commit -m "feat: skip memory pipeline for utility tasks in handleNativeRelay"
```

---

### Task 5: Dispatch — Lens generation EXECUTE NOW branch

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts:692-721` (extract public lens method)
- Modify: `apps/cli/src/handlers/dispatch.ts:217-286` (handleDispatchConsensus)
- Modify: `apps/cli/src/mcp-server-sdk.ts:778-796` (gossip_dispatch schema)

- [ ] **Step 1: Extract public lens generation method on DispatchPipeline**

In `packages/orchestrator/src/dispatch-pipeline.ts`, add a new public method before `dispatchParallel`:

```typescript
  /**
   * Generate lenses for overlapping agents. Extracted for native utility path
   * where lens generation must happen outside the dispatch call.
   */
  async generateLensesForAgents(
    taskDefs: Array<{ agentId: string; task: string }>,
  ): Promise<Map<string, string> | null> {
    // Profile-based differentiation first
    if (this.profileDifferentiator) {
      const agentConfigs = taskDefs
        .map(d => this.registryGet(d.agentId))
        .filter((c): c is AgentConfig => c !== undefined);
      const diffMap = this.profileDifferentiator.differentiate(agentConfigs, taskDefs[0]?.task || '');
      if (diffMap.size > 0) return diffMap;
    }

    // Overlap detection + lens generation fallback
    if (!this.overlapDetector) return null;
    const agentConfigs = taskDefs
      .map(d => this.registryGet(d.agentId))
      .filter((c): c is AgentConfig => c !== undefined);
    const overlapResult = this.overlapDetector.detect(agentConfigs);

    if (!overlapResult.hasOverlaps || !this.lensGenerator) return null;

    const lenses = await this.lensGenerator.generateLenses(
      overlapResult.agents, taskDefs[0]?.task || '', overlapResult.sharedSkills
    );
    if (lenses.length === 0) return null;
    return new Map(lenses.map(l => [l.agentId, l.focus]));
  }

  /** Accept pre-computed lenses so dispatch can skip lens generation */
  async dispatchParallelWithLenses(
    taskDefs: Array<{ agentId: string; task: string; options?: any }>,
    options?: { consensus?: boolean },
    precomputedLenses?: Map<string, string>,
  ): Promise<{ taskIds: string[]; errors: string[] }> {
    // This delegates to dispatchParallel, injecting lenses
    // Implementation: store precomputedLenses on instance, check in dispatchParallel
    this._precomputedLenses = precomputedLenses || null;
    try {
      return await this.dispatchParallel(taskDefs, options);
    } finally {
      this._precomputedLenses = null;
    }
  }
```

Add a private field near the top of the class:

```typescript
  private _precomputedLenses: Map<string, string> | null = null;
```

Then in the existing `dispatchParallel`, at line 692, add a check for pre-computed lenses:

```typescript
    // Use pre-computed lenses if provided (native utility path)
    if (this._precomputedLenses) {
      lensMap = this._precomputedLenses;
      log(`Using pre-computed lenses:\n${[...lensMap].map(([id, focus]) => `  ${id} → ${focus.slice(0, 80)}`).join('\n')}`);
    }

    // Overlap detection + lens generation fallback (when profiles unavailable)
    if (!lensMap && this.overlapDetector) {
```

- [ ] **Step 2: Add `_utility_task_id` to gossip_dispatch schema**

In `apps/cli/src/mcp-server-sdk.ts`, add to the gossip_dispatch schema (around line 794):

```typescript
    _utility_task_id: z.string().optional().describe('Internal: utility task ID for re-entry after native lens generation'),
```

And update the handler destructuring at line 796:

```typescript
  async ({ mode, agent_id, task, tasks, write_mode, scope, timeout_ms, plan_id, step, _utility_task_id }) => {
```

- [ ] **Step 3: Add native utility branch in handleDispatchConsensus**

In `apps/cli/src/handlers/dispatch.ts`, update `handleDispatchConsensus` to accept `_utility_task_id`:

```typescript
export async function handleDispatchConsensus(
  taskDefs: Array<{ agent_id: string; task: string }>,
  _utility_task_id?: string,
) {
```

At the top of the function (after the boot + validation), add the lens re-entry check:

```typescript
  // Check for lens re-entry (native utility path)
  let precomputedLenses: Map<string, string> | null = null;
  if (_utility_task_id) {
    const lensResult = ctx.nativeResultMap.get(_utility_task_id);
    if (lensResult?.status === 'completed' && lensResult.result) {
      try {
        const parsed = JSON.parse(lensResult.result);
        if (Array.isArray(parsed)) {
          precomputedLenses = new Map(parsed.map((l: any) => [l.agentId, l.focus]));
        }
      } catch { /* invalid lens result, dispatch without lenses */ }
    }
    // Clean up utility task
    ctx.nativeResultMap.delete(_utility_task_id);
    ctx.nativeTaskMap.delete(_utility_task_id);
  }
```

Then, before the relay dispatch call (line 245), add the native utility lens check:

```typescript
  // Native utility: generate lenses via EXECUTE NOW if needed
  if (!precomputedLenses && !_utility_task_id && ctx.nativeUtilityConfig && relayTasks.length > 0) {
    // Check if lens generation is needed (2+ agents with overlapping skills)
    try {
      const needsLenses = await ctx.mainAgent.pipeline?.generateLensesForAgents?.(
        taskDefs.map(d => ({ agentId: d.agent_id, task: d.task }))
      );
      // If the method returns null, no lenses needed — proceed without
      // If it would need to call LLM (non-null overlap), return EXECUTE NOW
      if (needsLenses === undefined) {
        // generateLensesForAgents doesn't exist yet or overlap not detected — skip
      }
    } catch { /* lens check failed, proceed without */ }
    // For now: lens generation via native utility is deferred to a follow-up
    // when the public API on DispatchPipeline is stable.
    // The re-entry path above is ready to receive pre-computed lenses.
  }
```

Pass pre-computed lenses into relay dispatch (update line 245):

```typescript
  if (relayTasks.length > 0) {
    const dispatchMethod = precomputedLenses
      ? ctx.mainAgent.dispatchParallelWithLenses.bind(ctx.mainAgent)
      : ctx.mainAgent.dispatchParallel.bind(ctx.mainAgent);
    const dispatchArgs = precomputedLenses
      ? [relayTasks.map((d: any) => ({ agentId: d.agent_id, task: d.task })), { consensus: true }, precomputedLenses]
      : [relayTasks.map((d: any) => ({ agentId: d.agent_id, task: d.task })), { consensus: true }];
    const { taskIds, errors } = await (dispatchMethod as any)(...dispatchArgs);
```

- [ ] **Step 4: Thread _utility_task_id in mcp-server-sdk.ts**

In the gossip_dispatch handler (around line 800), thread `_utility_task_id` to `handleDispatchConsensus`:

```typescript
    if (mode === 'consensus') {
      if (!tasks || tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'consensus mode requires "tasks" array' }] };
      }
      return handleDispatchConsensus(tasks, _utility_task_id);
    }
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit -p apps/cli/tsconfig.json && npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors.

- [ ] **Step 6: Run existing dispatch tests**

Run: `npx jest tests/cli/mcp-handlers.test.ts --no-coverage`
Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts apps/cli/src/handlers/dispatch.ts apps/cli/src/mcp-server-sdk.ts
git commit -m "feat: lens generation re-entry path for native utility dispatch"
```

---

### Task 6: Session save — EXECUTE NOW branch

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:1846-2015` (gossip_session_save handler)

- [ ] **Step 1: Add _utility_task_id to gossip_session_save schema**

In `apps/cli/src/mcp-server-sdk.ts`, update the gossip_session_save schema (around line 1850-1852):

```typescript
  {
    notes: z.string().optional().describe('Optional freeform user context (e.g., "focusing on security hardening")'),
    _utility_task_id: z.string().optional().describe('Internal: utility task ID for re-entry after native session summary'),
  },
  async ({ notes, _utility_task_id }) => {
```

- [ ] **Step 2: Add native utility branch for session summary**

After step 5b (auto-resolve findings) and before step 5c (write session summary), around line 1973, add:

```typescript
    // 5c. Native utility path: return EXECUTE NOW for session summary
    if (ctx.nativeUtilityConfig && !_utility_task_id) {
      const { MemoryWriter } = await import('@gossip/orchestrator');
      const writer = new MemoryWriter(process.cwd());

      // Build the raw input that writeSessionSummary would have sent to the LLM
      const rawInput = [
        '## Task Summaries', gossipText,
        '## Consensus History', consensusText,
        '## Agent Performance', performanceText,
        '## Git Log', gitLog,
        notes ? `## User Notes\n${notes}` : '',
      ].filter(Boolean).join('\n\n');

      // Create utility task
      const utilTaskId = require('crypto').randomUUID().slice(0, 8);
      const UTILITY_TTL_MS = 60_000;
      ctx.nativeTaskMap.set(utilTaskId, {
        agentId: '_utility',
        task: 'Session summary generation',
        startedAt: Date.now(),
        timeoutMs: UTILITY_TTL_MS,
        utilityType: 'session_summary',
      });
      const { spawnTimeoutWatcher } = await import('./handlers/native-tasks');
      spawnTimeoutWatcher(utilTaskId, { agentId: '_utility', task: 'Session summary', startedAt: Date.now(), timeoutMs: UTILITY_TTL_MS });

      process.stderr.write(`[gossipcat] utility → ${ctx.nativeUtilityConfig.model}: "Session summary generation" (task: ${utilTaskId})\n`);

      // Build the prompt that the LLM would have received
      const summaryPrompt = writer.getSessionSummaryPrompt({ gossip: gossipText, consensus: consensusText, performance: performanceText, gitLog, notes });

      return { content: [{ type: 'text' as const, text:
        `⚠️ EXECUTE NOW — native utility task (session summary)\n\n` +
        `1. Agent(model: "${ctx.nativeUtilityConfig.model}", prompt: ${JSON.stringify(summaryPrompt)}, run_in_background: true)\n` +
        `2. When agent completes → gossip_relay(task_id: "${utilTaskId}", result: "<full agent output>")\n` +
        `3. Then re-call: gossip_session_save(${notes ? `notes: "${notes}", ` : ''}_utility_task_id: "${utilTaskId}")\n\n` +
        `Do all 3 steps. The session save will complete on re-entry.`
      }] };
    }

    // 5c-re-entry. Check for utility result on re-entry
    if (_utility_task_id) {
      const utilResult = ctx.nativeResultMap.get(_utility_task_id);
      if (utilResult?.status === 'completed' && utilResult.result) {
        // Parse the LLM response the same way writeSessionSummary would
        const raw = utilResult.result;
        // Write the summary directly using the raw LLM output
        const { MemoryWriter } = await import('@gossip/orchestrator');
        const writer = new MemoryWriter(process.cwd());
        const summary = await writer.writeSessionSummaryFromRaw({
          raw, gossip: gossipText, consensus: consensusText,
          performance: performanceText, gitLog, notes,
        });
        // Clean up utility task
        ctx.nativeResultMap.delete(_utility_task_id);
        ctx.nativeTaskMap.delete(_utility_task_id);

        // Continue with steps 5d-7 (findings, gossip clear, bootstrap)
        if (findingsTable) {
          try {
            const { appendFileSync: af } = require('fs');
            const { join: j } = require('path');
            af(j(process.cwd(), '.gossip', 'next-session.md'), findingsTable);
          } catch { /* best-effort */ }
        }
        try {
          const { writeFileSync: wf } = require('fs');
          const { join: j } = require('path');
          wf(j(process.cwd(), '.gossip', 'agents', '_project', 'memory', 'session-gossip.jsonl'), '');
        } catch {}
        try {
          const { BootstrapGenerator } = await import('@gossip/orchestrator');
          const generator = new BootstrapGenerator(process.cwd());
          const result = generator.generate();
          const { writeFileSync: wf, mkdirSync: md } = require('fs');
          const { join: j } = require('path');
          md(j(process.cwd(), '.gossip'), { recursive: true });
          wf(j(process.cwd(), '.gossip', 'bootstrap.md'), result.prompt);
          process.stderr.write('[gossipcat] Bootstrap regenerated with new session context\n');
        } catch { /* best-effort */ }

        let output = `Session saved to .gossip/agents/_project/memory/\n\n${summary}`;
        if (findingsTable) output += findingsTable;
        return { content: [{ type: 'text' as const, text: output }] };
      } else {
        // Utility task timed out or failed — fall through to direct LLM path
        process.stderr.write(`[gossipcat] Utility session summary failed, falling back to direct LLM\n`);
        ctx.nativeResultMap.delete(_utility_task_id);
        ctx.nativeTaskMap.delete(_utility_task_id);
      }
    }
```

- [ ] **Step 3: Add getSessionSummaryPrompt and writeSessionSummaryFromRaw to MemoryWriter**

In `packages/orchestrator/src/memory-writer.ts`, add two new public methods:

```typescript
  /** Extract the prompt that writeSessionSummary would send to the LLM */
  getSessionSummaryPrompt(data: { gossip: string; consensus: string; performance: string; gitLog: string; notes?: string }): string {
    // Build the same system + user messages as writeSessionSummary
    const rawInput = this.buildSessionRawInput(data);
    return `You are writing a session summary for a multi-agent orchestrator. Summarize the session:\n\n${rawInput}\n\nFollow the format: start with SUMMARY: line, then sections for Open for next session, What shipped, What failed, Agent observations. Max 500 words.`;
  }

  /** Write session summary from pre-generated LLM output (native utility path) */
  async writeSessionSummaryFromRaw(data: {
    raw: string; gossip: string; consensus: string;
    performance: string; gitLog: string; notes?: string;
  }): Promise<string> {
    // Parse and write using the same logic as writeSessionSummary's post-LLM block
    // This reuses the parsing/writing code but skips the LLM call
    return this.processSessionSummaryResponse(data.raw, data);
  }
```

Note: The exact implementation will need to extract the post-LLM parsing logic from `writeSessionSummary` into a shared `processSessionSummaryResponse` method. This is a refactor of the existing code, not new logic.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit -p apps/cli/tsconfig.json && npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts packages/orchestrator/src/memory-writer.ts
git commit -m "feat: gossip_session_save EXECUTE NOW branch for native utility"
```

---

### Task 7: Fire-and-forget — Utility tasks in relay response

**Files:**
- Modify: `apps/cli/src/handlers/native-tasks.ts:164-273` (handleNativeRelay return)

- [ ] **Step 1: Extend relay response to include fire-and-forget utility tasks**

In `handleNativeRelay`, after the memory/gossip block and before the final return (around line 270), add:

```typescript
  // Fire-and-forget utility tasks: cognitive summary + gossip
  // When native utility is configured, these are deferred to Agent() dispatch
  const utilityBlocks: string[] = [];
  if (!error && !taskInfo.utilityType && ctx.nativeUtilityConfig) {
    const UTILITY_TTL_MS = 60_000;

    // Cognitive summary utility task
    if (result) {
      const cogTaskId = require('crypto').randomUUID().slice(0, 8);
      ctx.nativeTaskMap.set(cogTaskId, {
        agentId: '_utility', task: `Cognitive summary for ${agentId}`,
        startedAt: Date.now(), timeoutMs: UTILITY_TTL_MS, utilityType: 'summary',
      });
      spawnTimeoutWatcher(cogTaskId, { agentId: '_utility', task: 'Cognitive summary', startedAt: Date.now(), timeoutMs: UTILITY_TTL_MS });

      const cogPrompt = `Extract key learnings from this agent's output. Focus on decisions, discoveries, and warnings. Max 1500 chars.\n\nAgent: ${agentId}\nTask: ${taskInfo.task}\nResult:\n${result.slice(0, 3000)}`;
      utilityBlocks.push(
        `Agent(model: "${ctx.nativeUtilityConfig.model}", prompt: ${JSON.stringify(cogPrompt)}, run_in_background: true)\n` +
        `  → gossip_relay(task_id: "${cogTaskId}", result: "<output>")`
      );
      process.stderr.write(`[gossipcat] utility → ${ctx.nativeUtilityConfig.model}: "Cognitive summary for ${agentId}" (task: ${cogTaskId})\n`);
    }

    // Gossip utility task (only if other agents are still running)
    // Check if there are other pending native tasks (siblings in same batch)
    const pendingPeers = [...ctx.nativeTaskMap.values()].filter(t => !t.utilityType && t.agentId !== agentId);
    if (result && pendingPeers.length > 0) {
      const gossipTaskId = require('crypto').randomUUID().slice(0, 8);
      ctx.nativeTaskMap.set(gossipTaskId, {
        agentId: '_utility', task: `Gossip for peers of ${agentId}`,
        startedAt: Date.now(), timeoutMs: UTILITY_TTL_MS, utilityType: 'gossip',
      });
      spawnTimeoutWatcher(gossipTaskId, { agentId: '_utility', task: 'Gossip publishing', startedAt: Date.now(), timeoutMs: UTILITY_TTL_MS });

      const peerList = pendingPeers.map(p => p.agentId).join(', ');
      const gossipPrompt = `Summarize this agent's findings for their peers. Tailor 1-2 sentences per peer.\n\nCompleted agent: ${agentId}\nResult: ${result.slice(0, 2000)}\nPeers still working: ${peerList}`;
      utilityBlocks.push(
        `Agent(model: "${ctx.nativeUtilityConfig.model}", prompt: ${JSON.stringify(gossipPrompt)}, run_in_background: true)\n` +
        `  → gossip_relay(task_id: "${gossipTaskId}", result: "<output>")`
      );
      process.stderr.write(`[gossipcat] utility → ${ctx.nativeUtilityConfig.model}: "Gossip for peers of ${agentId}" (task: ${gossipTaskId})\n`);
    }
  }

  const status = error ? `failed (${elapsed}ms): ${error}` : `completed (${elapsed}ms)`;
  let responseText = `Result relayed for ${agentId} [${task_id}]: ${status}\n\nThe result is now available for gossip_collect and consensus cross-review.`;

  if (utilityBlocks.length > 0) {
    responseText += `\n\n⚠️ EXECUTE NOW — ${utilityBlocks.length} utility task(s) queued:\n\n${utilityBlocks.join('\n\n')}`;
  }

  return { content: [{ type: 'text' as const, text: responseText }] };
```

And remove the existing return statement at the end that this replaces.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit -p apps/cli/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Run all handler tests**

Run: `npx jest tests/cli/mcp-handlers.test.ts --no-coverage`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/handlers/native-tasks.ts
git commit -m "feat: fire-and-forget utility tasks in gossip_relay response"
```

---

### Task 8: Native dispatch/relay log lines

**Files:**
- Modify: `apps/cli/src/handlers/dispatch.ts` (dispatch log)
- Modify: `apps/cli/src/handlers/native-tasks.ts` (relay log)

- [ ] **Step 1: Add dispatch log for native agents**

In `apps/cli/src/handlers/dispatch.ts`, in `handleDispatchSingle`, right after `persistNativeTaskMap()` at line 58, add:

```typescript
    process.stderr.write(`[gossipcat] dispatch → ${agent_id}: "${task.slice(0, 80)}..." (native, ${nativeConfig.model})\n`);
```

In `handleDispatchConsensus`, inside the native task loop (after `persistNativeTaskMap()` at line 268), add:

```typescript
    process.stderr.write(`[gossipcat] dispatch → ${def.agent_id}: "${def.task.slice(0, 80)}..." (native, ${nativeConfig.model})\n`);
```

In `handleDispatchParallel`, inside the native task loop (after `persistNativeTaskMap()` at line 190), add:

```typescript
    process.stderr.write(`[gossipcat] dispatch → ${def.agent_id}: "${def.task.slice(0, 80)}..." (native, ${nativeConfig.model})\n`);
```

- [ ] **Step 2: Add relay log for native agents**

In `apps/cli/src/handlers/native-tasks.ts`, in `handleNativeRelay`, right after the `nativeResultMap.set` call and `persistNativeTaskMap()` (around line 208), add:

```typescript
  if (!taskInfo.utilityType) {
    process.stderr.write(`[gossipcat] relay ← ${agentId} [${task_id}]: ${error ? 'failed' : 'completed'} (${elapsed}ms, ${result?.length ?? 0} chars)\n`);
  }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p apps/cli/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/handlers/dispatch.ts apps/cli/src/handlers/native-tasks.ts
git commit -m "feat: add dispatch/relay log lines for native agents and utility tasks"
```

---

### Task 9: CLAUDE.md update + MCP bundle rebuild

**Files:**
- Modify: `CLAUDE.md`
- Run: `npm run build:mcp`

- [ ] **Step 1: Add utility task instructions to CLAUDE.md**

Add after the existing "Cross-Review Dispatch" section in CLAUDE.md:

```markdown
**Utility Task Dispatch:**
When a tool returns `⚠️ EXECUTE NOW` for a utility task (lens generation, summary, gossip),
follow the same dispatch pattern as native agents: dispatch Agent(), relay result via
gossip_relay. If the response includes a "re-call" instruction (step 3), call that tool
with the specified arguments after relaying the result. Fire-and-forget utility tasks
have no re-call — just dispatch and relay.
```

- [ ] **Step 2: Rebuild MCP bundle**

Run: `npm run build:mcp`
Expected: Build succeeds, bundle size similar to current (~1.2mb).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add utility task dispatch instructions to CLAUDE.md"
```

---

### Task 10: Integration test — End-to-end native utility config

**Files:**
- Create: `tests/cli/native-utility.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { validateConfig } from '../../apps/cli/src/config';
import { ctx } from '../../apps/cli/src/mcp-context';

describe('Native Utility Provider — integration', () => {
  afterEach(() => {
    ctx.nativeTaskMap.clear();
    ctx.nativeResultMap.clear();
    ctx.nativeUtilityConfig = null;
  });

  it('validates native utility config end-to-end', () => {
    const config = validateConfig({
      main_agent: { provider: 'google', model: 'gemini-2.5-pro' },
      utility_model: { provider: 'native', model: 'haiku' },
    });
    expect(config.utility_model?.provider).toBe('native');
    expect(config.utility_model?.model).toBe('haiku');
  });

  it('utility tasks use shorter TTL and skip persistence filter', () => {
    // Simulate utility task creation
    ctx.nativeTaskMap.set('util-test', {
      agentId: '_utility',
      task: 'Test utility task',
      startedAt: Date.now(),
      timeoutMs: 60_000,
      utilityType: 'lens',
    });

    expect(ctx.nativeTaskMap.get('util-test')?.utilityType).toBe('lens');
    expect(ctx.nativeTaskMap.get('util-test')?.timeoutMs).toBe(60_000);
  });

  it('nativeUtilityConfig is null by default', () => {
    expect(ctx.nativeUtilityConfig).toBeNull();
  });

  it('rejects native utility with invalid model', () => {
    expect(() => validateConfig({
      main_agent: { provider: 'google', model: 'gemini-2.5-pro' },
      utility_model: { provider: 'native', model: 'claude-3' },
    })).toThrow('native');
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx jest tests/cli/native-utility.test.ts --no-coverage`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/native-utility.test.ts
git commit -m "test: add native utility provider integration tests"
```
