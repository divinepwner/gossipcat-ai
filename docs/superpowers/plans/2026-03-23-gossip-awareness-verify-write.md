# Gossip Awareness + verify_write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable cross-task context awareness via session gossip and chain threading, plus a `verify_write` tool for peer-reviewed write verification.

**Architecture:** Session gossip accumulates task summaries in DispatchPipeline and injects them into subsequent agent prompts. Chain threading stores plan state keyed by `plan_id` and auto-injects prior step results. `verify_write` is a Tool Server tool that runs tests, captures diffs, and dispatches a reviewer via RPC to the orchestrator.

**Tech Stack:** TypeScript, Jest, @gossip/orchestrator, @gossip/tools, @gossip/client (GossipAgent for orchestrator relay identity)

**Spec:** `docs/superpowers/specs/2026-03-23-gossip-awareness-verify-write-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/types.ts` | **Edit** | Add `SessionGossipEntry`, `PlanState`, extend `DispatchOptions` + `TaskEntry` |
| `packages/orchestrator/src/prompt-assembler.ts` | **Edit** | Add `sessionContext`/`chainContext` optional params |
| `packages/orchestrator/src/dispatch-pipeline.ts` | **Edit** | Add session gossip state + plan state, inject context in `dispatch()`, summarize in `collect()`, `registerPlan()` |
| `packages/orchestrator/src/main-agent.ts` | **Edit** | Pass LLM to pipeline, add `registerPlan()` passthrough, connect orchestrator GossipAgent, handle `review_request` RPC |
| `packages/orchestrator/src/index.ts` | **Edit** | Export new types |
| `packages/tools/src/definitions.ts` | **Edit** | Add `verify_write` to ALL_TOOLS |
| `packages/tools/src/tool-server.ts` | **Edit** | Add `verify_write` handler, `requestPeerReview()`, `pendingReviews` map |
| `packages/orchestrator/src/worker-agent.ts` | **Edit** | Increase tool timeout to 60s |
| `apps/cli/src/mcp-server-sdk.ts` | **Edit** | Add `plan_id`/`step` to `gossip_dispatch`, store plan from `gossip_plan` |
| `tests/orchestrator/dispatch-pipeline-gossip.test.ts` | **Create** | Session gossip + chain threading tests |
| `tests/tools/tool-server-verify.test.ts` | **Create** | verify_write tests |

---

### Task 1: Add types (SessionGossipEntry, PlanState, DispatchOptions/TaskEntry extensions)

**Files:**
- Modify: `packages/orchestrator/src/types.ts`

- [ ] **Step 1: Add new types**

In `packages/orchestrator/src/types.ts`, after the `PlannedTask` interface, add:

```typescript
/** Session gossip entry — accumulated across all dispatches */
export interface SessionGossipEntry {
  agentId: string;
  taskSummary: string;
  timestamp: number;
}

/** Stored plan state for chain threading */
export interface PlanState {
  id: string;
  task: string;
  strategy: string;
  steps: Array<{
    step: number;
    agentId: string;
    task: string;
    writeMode?: string;
    scope?: string;
    result?: string;
    completedAt?: number;
  }>;
  createdAt: number;
}
```

Extend `DispatchOptions` — add after `timeoutMs`:

```typescript
  planId?: string;
  step?: number;
```

Extend `TaskEntry` — add after `worktreeInfo`:

```typescript
  planId?: string;
  planStep?: number;
```

- [ ] **Step 2: Verify build**

Run: `npx jest --config jest.config.base.js tests/orchestrator/dispatch-pipeline.test.ts --verbose`
Expected: All existing tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/types.ts
git commit -m "feat(types): add SessionGossipEntry, PlanState, planId/step fields"
```

---

### Task 2: Update prompt-assembler with sessionContext/chainContext

**Files:**
- Modify: `packages/orchestrator/src/prompt-assembler.ts`

- [ ] **Step 1: Add new optional fields**

Change the `assemblePrompt` function to:

```typescript
export function assemblePrompt(parts: {
  memory?: string;
  lens?: string;
  skills?: string;
  context?: string;
  sessionContext?: string;
  chainContext?: string;
}): string {
  const blocks: string[] = [];

  if (parts.chainContext) {
    blocks.push(`\n\n${parts.chainContext}`);
  }

  if (parts.sessionContext) {
    blocks.push(`\n\n${parts.sessionContext}`);
  }

  if (parts.memory) {
    blocks.push(`\n\n--- MEMORY ---\n${parts.memory}\n--- END MEMORY ---`);
  }

  if (parts.lens) {
    blocks.push(`\n\n--- LENS ---\n${parts.lens}\n--- END LENS ---`);
  }

  if (parts.skills) {
    blocks.push(`\n\n--- SKILLS ---\n${parts.skills}\n--- END SKILLS ---`);
  }

  if (parts.context) {
    blocks.push(`\n\nContext:\n${parts.context}`);
  }

  return blocks.join('');
}
```

- [ ] **Step 2: Verify existing tests pass**

Run: `npx jest --config jest.config.base.js tests/orchestrator/ --verbose`
Expected: All pass — new fields are optional, backward compatible

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/prompt-assembler.ts
git commit -m "feat(prompt-assembler): add sessionContext and chainContext fields"
```

---

### Task 3: Add session gossip to DispatchPipeline

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`
- Create: `tests/orchestrator/dispatch-pipeline-gossip.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/dispatch-pipeline-gossip.test.ts`:

```typescript
import { DispatchPipeline } from '@gossip/orchestrator';

function mockWorker(result = 'found 3 bugs in tool-server.ts') {
  return {
    executeTask: jest.fn().mockResolvedValue(result),
    subscribeToBatch: jest.fn().mockResolvedValue(undefined),
    unsubscribeFromBatch: jest.fn().mockResolvedValue(undefined),
  };
}

// Mock LLM for summarization
function mockLLM(summary = 'Found 3 bugs in tool-server.ts') {
  return { generate: jest.fn().mockResolvedValue({ text: summary }) };
}

describe('Session Gossip', () => {
  it('injects prior task summary into next dispatch prompt', async () => {
    const workers = new Map([['agent-a', mockWorker()], ['agent-b', mockWorker()]]);
    const llm = mockLLM();
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'mock', skills: [] }),
      llm,
    });

    // Dispatch and collect first task
    const t1 = pipeline.dispatch('agent-a', 'review code');
    await pipeline.collect([t1.taskId]);

    // Dispatch second task — should have session context
    const t2 = pipeline.dispatch('agent-b', 'fix bugs');
    const worker = workers.get('agent-b')!;
    const prompt = worker.executeTask.mock.calls[0][2]; // third arg is promptContent
    expect(prompt).toContain('Session Context');
    expect(prompt).toContain('agent-a');
  });

  it('caps session gossip at 20 entries', async () => {
    const workers = new Map([['agent', mockWorker()]]);
    const llm = mockLLM();
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'mock', skills: [] }),
      llm,
    });

    // Dispatch 25 tasks
    for (let i = 0; i < 25; i++) {
      const t = pipeline.dispatch('agent', `task ${i}`);
      await pipeline.collect([t.taskId]);
    }

    // 26th dispatch should only have 20 gossip entries
    const t = pipeline.dispatch('agent', 'final task');
    const prompt = workers.get('agent')!.executeTask.mock.calls[25][2];
    const matches = (prompt || '').match(/- agent:/g) || [];
    expect(matches.length).toBeLessThanOrEqual(20);
  });

  it('skips summarization when no LLM provided', async () => {
    const workers = new Map([['agent', mockWorker()]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'mock', skills: [] }),
      // no llm provided
    });

    const t1 = pipeline.dispatch('agent', 'task 1');
    await pipeline.collect([t1.taskId]);

    const t2 = pipeline.dispatch('agent', 'task 2');
    const prompt = workers.get('agent')!.executeTask.mock.calls[1][2] || '';
    expect(prompt).not.toContain('Session Context');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.base.js tests/orchestrator/dispatch-pipeline-gossip.test.ts --verbose`
Expected: FAIL — DispatchPipelineConfig doesn't accept `llm`

- [ ] **Step 3: Implement session gossip in DispatchPipeline**

In `packages/orchestrator/src/dispatch-pipeline.ts`:

1. Add import: `import { ILLMProvider } from './llm-client';`
2. Add import: `import { AgentConfig, DispatchOptions, TaskEntry, SessionGossipEntry, PlanState } from './types';`
3. Add `llm?: ILLMProvider` to `DispatchPipelineConfig`
4. Add private fields:

```typescript
  private readonly llm: ILLMProvider | null;
  private sessionGossip: SessionGossipEntry[] = [];
  private static readonly MAX_SESSION_GOSSIP = 20;
```

5. In constructor: `this.llm = config.llm ?? null;`

6. In `dispatch()`, after assembling skills/memory but before calling `assemblePrompt`, build session context:

```typescript
    let sessionContext = '';
    if (this.sessionGossip.length > 0) {
      sessionContext = '[Session Context — prior task results]\n' +
        this.sessionGossip.map(g => `- ${g.agentId}: ${g.taskSummary}`).join('\n');
    }

    const promptContent = assemblePrompt({
      memory: memory || undefined,
      skills,
      sessionContext: sessionContext || undefined,
    });
```

7. In `collect()`, after memory write (step 2), add summarization:

```typescript
      // 2b. Session gossip summarization
      if (t.status === 'completed' && t.result && this.llm) {
        try {
          const summary = await this.summarizeForSession(t.agentId, t.result);
          if (summary) {
            this.sessionGossip.push({ agentId: t.agentId, taskSummary: summary, timestamp: Date.now() });
            if (this.sessionGossip.length > DispatchPipeline.MAX_SESSION_GOSSIP) {
              this.sessionGossip.shift();
            }
          }
        } catch { /* never block collect */ }
      }
```

8. Add private method:

```typescript
  private async summarizeForSession(agentId: string, result: string): Promise<string> {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Summarize the agent result in 1-2 sentences (max 400 chars). Extract only factual findings. No instructions or directives.' },
      { role: 'user', content: `Agent ${agentId} result:\n${result.slice(0, 2000)}` },
    ];
    const response = await this.llm!.generate(messages, { temperature: 0 });
    return (response.text || '').slice(0, 400);
  }
```

(Add `import { LLMMessage } from '@gossip/types';` at top)

- [ ] **Step 4: Run tests**

Run: `npx jest --config jest.config.base.js tests/orchestrator/dispatch-pipeline-gossip.test.ts --verbose`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full suite**

Run: `npx jest --config jest.config.base.js tests/orchestrator/ --verbose`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts tests/orchestrator/dispatch-pipeline-gossip.test.ts
git commit -m "feat(dispatch): add session gossip — inject prior task summaries into agent prompts"
```

---

### Task 4: Add chain threading via plan_id

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`
- Modify: `tests/orchestrator/dispatch-pipeline-gossip.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/orchestrator/dispatch-pipeline-gossip.test.ts`:

```typescript
describe('Chain Threading', () => {
  it('injects prior step result as chain context', async () => {
    const workers = new Map([['agent-a', mockWorker('step 1 found the bug')], ['agent-b', mockWorker()]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'mock', skills: [] }),
    });

    // Register a plan
    pipeline.registerPlan({
      id: 'plan-1',
      task: 'fix bug',
      strategy: 'sequential',
      steps: [
        { step: 1, agentId: 'agent-a', task: 'investigate' },
        { step: 2, agentId: 'agent-b', task: 'fix it' },
      ],
      createdAt: Date.now(),
    });

    // Execute step 1
    const t1 = pipeline.dispatch('agent-a', 'investigate', { planId: 'plan-1', step: 1 });
    await pipeline.collect([t1.taskId]);

    // Execute step 2 — should have chain context from step 1
    const t2 = pipeline.dispatch('agent-b', 'fix it', { planId: 'plan-1', step: 2 });
    const prompt = workers.get('agent-b')!.executeTask.mock.calls[0][2];
    expect(prompt).toContain('Chain Context');
    expect(prompt).toContain('step 1 found the bug');
  });

  it('gracefully handles missing plan_id', () => {
    const workers = new Map([['agent', mockWorker()]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'mock', skills: [] }),
    });

    // Dispatch with non-existent plan — should not throw
    expect(() => pipeline.dispatch('agent', 'task', { planId: 'nonexistent', step: 2 })).not.toThrow();
  });

  it('cleans up completed plans', async () => {
    const workers = new Map([['agent', mockWorker()]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'mock', skills: [] }),
    });

    pipeline.registerPlan({
      id: 'plan-done',
      task: 'one step',
      strategy: 'single',
      steps: [{ step: 1, agentId: 'agent', task: 'do it' }],
      createdAt: Date.now(),
    });

    const t = pipeline.dispatch('agent', 'do it', { planId: 'plan-done', step: 1 });
    await pipeline.collect([t.taskId]);

    // Plan should be cleaned up (all steps have results)
    // Dispatch step 2 referencing this plan — should get no chain context (plan gone)
    const t2 = pipeline.dispatch('agent', 'next', { planId: 'plan-done', step: 2 });
    const prompt = workers.get('agent')!.executeTask.mock.calls[1][2] || '';
    expect(prompt).not.toContain('Chain Context');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest --config jest.config.base.js tests/orchestrator/dispatch-pipeline-gossip.test.ts --verbose`
Expected: FAIL — `registerPlan` doesn't exist

- [ ] **Step 3: Implement chain threading**

In `packages/orchestrator/src/dispatch-pipeline.ts`:

1. Add field: `private plans: Map<string, PlanState> = new Map();`

2. Add public method:

```typescript
  registerPlan(plan: PlanState): void {
    this.plans.set(plan.id, plan);
  }
```

3. In `dispatch()`, after session context but before `assemblePrompt`, add chain context:

```typescript
    let chainContext = '';
    if (options?.planId && options?.step && options.step > 1) {
      const plan = this.plans.get(options.planId);
      if (plan) {
        const priorSteps = plan.steps.filter(s => s.step < options.step! && s.result);
        if (priorSteps.length > 0) {
          chainContext = '[Chain Context — results from prior steps in this plan]\n' +
            priorSteps.map(s => `Step ${s.step} (${s.agentId}): ${s.result!.slice(0, 1000)}`).join('\n\n');
        }
      }
    }
    entry.planId = options?.planId;
    entry.planStep = options?.step;
```

4. Pass chainContext to assemblePrompt:

```typescript
    const promptContent = assemblePrompt({
      memory: memory || undefined,
      skills,
      sessionContext: sessionContext || undefined,
      chainContext: chainContext || undefined,
    });
```

5. In `collect()`, after session gossip summarization, store result in plan state:

```typescript
      // 2c. Store result in plan state for chain threading
      if (t.planId && t.planStep) {
        const plan = this.plans.get(t.planId);
        if (plan) {
          const step = plan.steps.find(s => s.step === t.planStep);
          if (step) {
            step.result = (t.result || '').slice(0, 2000);
            step.completedAt = Date.now();
          }
        }
      }
```

6. In `collect()`, after batch cleanup (step 5), add plan cleanup:

```typescript
    // 7. Plan cleanup — remove completed or expired plans
    for (const [id, plan] of this.plans) {
      const allDone = plan.steps.every(s => s.result !== undefined);
      const expired = Date.now() - plan.createdAt > 3_600_000;
      if (allDone || expired) this.plans.delete(id);
    }
```

7. Update `getTask()` and the `results` mapping in `collect()` to include `planId`/`planStep` fields.

- [ ] **Step 4: Run tests**

Run: `npx jest --config jest.config.base.js tests/orchestrator/dispatch-pipeline-gossip.test.ts --verbose`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts tests/orchestrator/dispatch-pipeline-gossip.test.ts
git commit -m "feat(dispatch): add chain threading via plan_id — auto-inject prior step results"
```

---

### Task 5: Update MainAgent (LLM passthrough, registerPlan, orchestrator relay identity)

**Files:**
- Modify: `packages/orchestrator/src/main-agent.ts`

- [ ] **Step 1: Pass LLM to DispatchPipeline**

In the constructor where `this.pipeline = new DispatchPipeline({...})` is called, add `llm: this.llm`:

```typescript
    this.pipeline = new DispatchPipeline({
      projectRoot: this.projectRoot,
      workers: this.workers,
      registryGet: (id) => this.registry.get(id),
      llm: this.llm,
    });
```

- [ ] **Step 2: Add registerPlan passthrough**

After the existing `dispatch`/`collect`/`dispatchParallel` methods:

```typescript
  registerPlan(plan: PlanState): void { this.pipeline.registerPlan(plan); }
```

Add import: `import { AgentConfig, DispatchOptions, PlanState, TaskResult, ChatResponse } from './types';`

- [ ] **Step 3: Add orchestrator relay identity**

Add field: `private orchestratorAgent: GossipAgent | null = null;`

Add import: `import { GossipAgent } from '@gossip/client';`

In `start()`, after the worker loop, connect the orchestrator agent:

```typescript
    // Connect orchestrator agent to relay for verify_write review requests
    try {
      this.orchestratorAgent = new GossipAgent({ agentId: 'orchestrator', relayUrl: this.relayUrl, reconnect: true });
      await this.orchestratorAgent.connect();
      this.orchestratorAgent.on('message', this.handleReviewRequest.bind(this));
    } catch (err) {
      console.error(`[MainAgent] Orchestrator relay connection failed: ${(err as Error).message}`);
    }
```

- [ ] **Step 4: Add handleReviewRequest**

```typescript
  private async handleReviewRequest(data: unknown, envelope: MessageEnvelope): Promise<void> {
    if (envelope.t !== MessageType.RPC_REQUEST) return;

    const payload = data as Record<string, unknown>;
    if (payload?.tool !== 'review_request') return;

    const args = payload.args as { callerId: string; diff: string; testResult: string };
    let reviewText = 'No reviewer available — tests-only verification.';

    try {
      // Find best reviewer, excluding the calling agent
      const reviewer = this.registry.getAll()
        .filter(a => a.id !== args.callerId && a.skills.includes('code_review'))
        .find(a => this.workers.has(a.id));

      if (reviewer) {
        const { taskId, promise } = this.pipeline.dispatch(reviewer.id,
          `Review this diff for correctness:\n\n${args.diff}\n\nTest results:\n${args.testResult}\n\nProvide a brief review: what's good, what needs fixing.`
        );
        try {
          reviewText = await promise;
        } catch { reviewText = 'Reviewer agent failed.'; }
      }
    } catch (err) {
      reviewText = `Review error: ${(err as Error).message}`;
    }

    // Send RPC response back to ToolServer
    try {
      const { encode: msgpackEncode } = await import('@msgpack/msgpack');
      const { Message } = await import('@gossip/types');
      const body = Buffer.from(msgpackEncode({ result: reviewText })) as unknown as Uint8Array;
      const correlationId = (envelope.rid_req || envelope.id) as string;
      const response = Message.createRpcResponse('orchestrator', envelope.sid, correlationId, body);
      await this.orchestratorAgent!.sendEnvelope(response.toEnvelope());
    } catch (err) {
      console.error(`[MainAgent] Failed to send review response: ${(err as Error).message}`);
    }
  }
```

Add imports at top: `import { MessageType, MessageEnvelope, Message } from '@gossip/types';`

- [ ] **Step 5: Verify build**

Run: `npx jest --config jest.config.base.js tests/orchestrator/ --verbose`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts
git commit -m "feat(main-agent): pass LLM to pipeline, registerPlan, orchestrator relay for review requests"
```

---

### Task 6: Add verify_write tool definition

**Files:**
- Modify: `packages/tools/src/definitions.ts`

- [ ] **Step 1: Add verify_write to tool definitions**

At the end of the tool array in `packages/tools/src/definitions.ts`, add:

```typescript
  {
    name: 'verify_write',
    description: 'Run tests and get a peer review of your changes. Call this after writing files to verify correctness. Returns test results + reviewer feedback.',
    parameters: {
      type: 'object',
      properties: {
        test_file: {
          type: 'string',
          description: 'Specific test file to run (e.g. "tests/tools/tool-server-scope.test.ts"). If omitted, runs full test suite.',
        },
      },
    },
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/tools/src/definitions.ts
git commit -m "feat(tools): add verify_write tool definition"
```

---

### Task 7: Implement verify_write in ToolServer

**Files:**
- Modify: `packages/tools/src/tool-server.ts`
- Create: `tests/tools/tool-server-verify.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/tool-server-verify.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolServer } from '../../packages/tools/src/tool-server';

jest.mock('@gossip/client', () => ({
  GossipAgent: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    agentId: 'tool-server',
    sendEnvelope: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('verify_write tool', () => {
  let server: ToolServer;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gossip-verify-'));
    server = new ToolServer({ relayUrl: 'ws://localhost:0', projectRoot });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns "no changes" when git diff is empty', async () => {
    // Mock git to return empty diff
    const result = await server.executeTool('verify_write', {}, 'agent-1');
    expect(result).toContain('No changes detected');
  });

  it('is not blocked by scope enforcement for scoped agents', async () => {
    server.assignScope('agent-1', 'packages/relay/');
    // verify_write should NOT throw "Shell execution blocked"
    const result = await server.executeTool('verify_write', {}, 'agent-1');
    // It may fail for other reasons (no git repo) but not scope enforcement
    expect(result).not.toContain('Shell execution blocked');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest --config jest.config.base.js tests/tools/tool-server-verify.test.ts --verbose`
Expected: FAIL — verify_write not in switch

- [ ] **Step 3: Implement verify_write handler**

In `packages/tools/src/tool-server.ts`:

1. Add to imports: `import { randomUUID } from 'crypto';`

2. Add private fields:

```typescript
  private pendingReviews: Map<string, { resolve: (r: string) => void; reject: (e: Error) => void }> = new Map();
```

3. Add `verify_write` case in `executeTool` switch, BEFORE the `default`:

```typescript
      case 'verify_write':
        return this.handleVerifyWrite(callerId || 'unknown', args.test_file as string | undefined);
```

4. Add the handler method:

```typescript
  private async handleVerifyWrite(callerId: string, testFile?: string): Promise<string> {
    // 1. Capture git diff (call gitTools directly, not through executeTool)
    let fullDiff = '';
    try {
      const diff = await this.gitTools.gitDiff({ staged: false });
      const staged = await this.gitTools.gitDiff({ staged: true });
      fullDiff = [diff, staged].filter(Boolean).join('\n');
    } catch { /* not a git repo */ }

    if (!fullDiff.trim()) {
      return 'No changes detected. Nothing to verify.';
    }

    // 2. Run tests (call shellTools directly — bypasses enforceWriteScope for scoped agents)
    if (testFile) this.sandbox.validatePath(testFile);
    const cmd = testFile
      ? `npx jest --config jest.config.base.js ${testFile} --verbose`
      : 'npx jest --config jest.config.base.js --verbose';
    let testResult: string;
    try {
      testResult = await this.shellTools.shellExec({ command: cmd, cwd: this.sandbox.projectRoot, timeout: 30000 });
    } catch (err) {
      testResult = `Tests failed: ${(err as Error).message}`;
    }

    // 3. Request peer review via RPC (best-effort)
    let reviewResult = '';
    try {
      reviewResult = await this.requestPeerReview(callerId, fullDiff, testResult);
    } catch (err) {
      reviewResult = `Peer review unavailable: ${(err as Error).message}`;
    }

    // 4. Format result
    const testStatus = testResult.includes('FAIL') ? 'FAIL' : 'PASS';
    return `## Verification Result\n\n### Tests: ${testStatus}\n${testResult.slice(-2000)}\n\n### Peer Review\n${reviewResult || 'No reviewer available'}\n\n### Diff Summary\n${fullDiff.slice(0, 3000)}`;
  }

  private async requestPeerReview(callerId: string, diff: string, testResult: string): Promise<string> {
    const requestId = randomUUID();

    const reviewPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReviews.delete(requestId);
        reject(new Error('Review timed out'));
      }, 55_000);
      timer.unref();

      this.pendingReviews.set(requestId, {
        resolve: (r: string) => { clearTimeout(timer); resolve(r); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      });
    });

    const { encode: msgpackEncode } = await import('@msgpack/msgpack');
    const { Message } = await import('@gossip/types');
    const body = Buffer.from(msgpackEncode({
      tool: 'review_request',
      args: { callerId, diff: diff.slice(0, 3000), testResult: testResult.slice(0, 1000) },
    })) as unknown as Uint8Array;
    const msg = Message.createRpcRequest(this.agent.agentId, 'orchestrator', requestId, body);
    await this.agent.sendEnvelope(msg.toEnvelope());

    return reviewPromise;
  }
```

5. Add handler for RPC responses (review results coming back from orchestrator). In the constructor or `start()`, ensure the message handler also processes `RPC_RESPONSE` for pending reviews:

In `handleToolRequest`, add before the existing `if (envelope.t !== MessageType.RPC_REQUEST) return;`:

```typescript
    // Handle review responses from orchestrator
    if (envelope.t === MessageType.RPC_RESPONSE) {
      const correlationId = (envelope.rid_req || envelope.id) as string;
      const pending = this.pendingReviews.get(correlationId);
      if (pending) {
        this.pendingReviews.delete(correlationId);
        const payload = data as Record<string, unknown>;
        if (payload?.error) pending.reject(new Error(payload.error as string));
        else pending.resolve((payload?.result as string) || '');
      }
      return;
    }
```

- [ ] **Step 4: Run tests**

Run: `npx jest --config jest.config.base.js tests/tools/tool-server-verify.test.ts --verbose`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/tool-server.ts tests/tools/tool-server-verify.test.ts
git commit -m "feat(tools): implement verify_write — tests, diff, peer review via orchestrator RPC"
```

---

### Task 8: Increase worker tool timeout to 60s

**Files:**
- Modify: `packages/orchestrator/src/worker-agent.ts`

- [ ] **Step 1: Update timeout constant**

Change `const TOOL_CALL_TIMEOUT_MS = 30_000;` to `const TOOL_CALL_TIMEOUT_MS = 60_000;`

- [ ] **Step 2: Verify tests**

Run: `npx jest --config jest.config.base.js --verbose`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/worker-agent.ts
git commit -m "feat(worker): increase tool call timeout to 60s for verify_write"
```

---

### Task 9: Update MCP tools (plan_id/step in gossip_dispatch, plan storage in gossip_plan)

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add plan_id and step to gossip_dispatch schema**

In the `gossip_dispatch` tool, add to the schema object:

```typescript
    plan_id: z.string().optional().describe('Plan ID from gossip_plan. Enables chain context from prior steps.'),
    step: z.number().optional().describe('Step number in the plan (1-indexed).'),
```

Update the destructuring: `async ({ agent_id, task, write_mode, scope, timeout_ms, plan_id, step }) =>`

Update the options mapping:

```typescript
    const options: any = {};
    if (write_mode) { options.writeMode = write_mode; options.scope = scope; options.timeoutMs = timeout_ms; }
    if (plan_id) { options.planId = plan_id; options.step = step; }
    const dispatchOptions = Object.keys(options).length > 0 ? options : undefined;
    const { taskId } = mainAgent.dispatch(agent_id, task, dispatchOptions);
```

- [ ] **Step 2: Store plan state from gossip_plan**

In the `gossip_plan` tool handler, after building `planJson`, store the plan:

```typescript
      // Store plan state for chain threading
      const planId = randomUUID().slice(0, 8);
      const planState = {
        id: planId,
        task,
        strategy: plan.strategy,
        steps: planJson.tasks.map((t: any, i: number) => ({
          step: i + 1,
          agentId: t.agent_id,
          task: t.task,
          writeMode: t.write_mode,
          scope: t.scope,
        })),
        createdAt: Date.now(),
      };
      mainAgent.registerPlan(planState);
```

Include `Plan ID: ${planId}` in the output text.

Add `plan_id: "${planId}", step: N` to each step in the sequential dispatch output.

- [ ] **Step 3: Export new types from orchestrator index**

In `packages/orchestrator/src/index.ts`, verify `export * from './types'` already covers `SessionGossipEntry`, `PlanState` (it should — they're in types.ts).

- [ ] **Step 4: Build and test**

Run: `npm run build:mcp && npx jest --config jest.config.base.js --verbose`
Expected: Clean build, all tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts packages/orchestrator/src/index.ts
git commit -m "feat(mcp): add plan_id/step to gossip_dispatch, store plan state from gossip_plan"
```

---

### Task 10: Full regression + smoke test

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --config jest.config.base.js --verbose`
Expected: All tests pass

- [ ] **Step 2: Build MCP**

Run: `npm run build:mcp`
Expected: Clean build

- [ ] **Step 3: Smoke test gossip_plan with plan_id**

After `/mcp` reconnect:
```
gossip_plan(task: "fix the scope validation bug in packages/tools/")
```
Verify response includes `Plan ID:` and sequential steps include `plan_id` and `step` params.

- [ ] **Step 4: Smoke test session gossip**

Dispatch two tasks sequentially, collect each. Verify the second agent mentions prior context in its result (indirectly — we can't inspect the prompt from MCP, but we can check if the agent's behavior changes).

- [ ] **Step 5: Verify line counts**

Run: `wc -l packages/orchestrator/src/dispatch-pipeline.ts packages/tools/src/tool-server.ts packages/orchestrator/src/main-agent.ts`
Note if any file exceeds 350 lines — flag for future split.
