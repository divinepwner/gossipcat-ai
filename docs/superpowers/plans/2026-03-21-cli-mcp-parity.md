# CLI/MCP Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dispatch pipeline (memory, skills, TaskGraph, gossip) from MCP server into MainAgent so CLI chat and MCP both get identical features.

**Architecture:** Extract pipeline logic into a new `DispatchPipeline` class that MainAgent delegates to. MCP server becomes a thin adapter (~200 lines). The split keeps MainAgent under 300 lines.

**Tech Stack:** TypeScript, vitest, @gossip/orchestrator, @gossip/tools

**Spec:** `docs/superpowers/specs/2026-03-21-cli-mcp-parity-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/dispatch-pipeline.ts` | **Create** | `DispatchPipeline` class: dispatch(), collect(), dispatchParallel(), writeMemoryForTask(), tasks Map, batches Map, all pipeline instances (~180 lines) |
| `packages/orchestrator/src/types.ts` | **Edit** | Add `TaskEntry` interface |
| `packages/orchestrator/src/main-agent.ts` | **Edit** | Add `projectRoot`, `DispatchPipeline` instance, delegate dispatch/collect/dispatchParallel/syncWorkers/getWorker. Update `executeSubTask` to use pipeline. (~250 lines) |
| `packages/orchestrator/src/skill-loader.ts` | **Edit** | Add hyphen fallback in `resolveSkill()` (port from bridge) |
| `packages/orchestrator/src/index.ts` | **Edit** | Export `DispatchPipeline`, `TaskEntry` |
| `apps/cli/src/mcp-server-sdk.ts` | **Rewrite** | Slim to ~200 lines — delegate dispatch/collect/dispatchParallel to `mainAgent`, keep gossip_update_instructions/gossip_agents/gossip_status/gossip_tools as-is |
| `apps/cli/src/chat.ts` | **Edit** | Pass `projectRoot` in MainAgentConfig |
| `apps/cli/src/skill-loader-bridge.ts` | **Delete** | Logic moved into orchestrator's loadSkills + DispatchPipeline |
| `apps/cli/src/skill-catalog-check.ts` | **Delete** | Replaced by SkillCatalog.checkCoverage in pipeline |
| `tests/orchestrator/dispatch-pipeline.test.ts` | **Create** | Unit tests for dispatch(), collect(), dispatchParallel(), writeMemoryForTask() |
| `tests/orchestrator/main-agent.test.ts` | **Edit** | Add tests for dispatch/collect delegation and executeSubTask pipeline |

---

### Task 1: Add TaskEntry to types.ts

**Files:**
- Modify: `packages/orchestrator/src/types.ts:104` (after ArchivedTaskEntry)

- [ ] **Step 1: Add TaskEntry interface**

In `packages/orchestrator/src/types.ts`, after the `ArchivedTaskEntry` interface (line ~112), add:

```typescript
/** A tracked dispatch task with status and result */
export interface TaskEntry {
  id: string;
  agentId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  skillWarnings?: string[];
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/types.ts
git commit -m "feat(types): add TaskEntry interface for dispatch pipeline"
```

---

### Task 2: Add hyphen fallback to skill-loader.ts

**Files:**
- Modify: `packages/orchestrator/src/skill-loader.ts:28-50` (resolveSkill function)
- Test: `tests/orchestrator/skill-loader.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/orchestrator/skill-loader.test.ts`, add a test that loads a skill named `code_review` and expects it to resolve to `code-review.md`:

```typescript
it('resolves underscore skill names to hyphenated filenames', () => {
  // Setup: create .gossip/skills/code-review.md in tmp dir
  const skillDir = join(tmpDir, '.gossip', 'skills');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'code-review.md'), '# Code Review Skill');

  const result = loadSkills('test-agent', ['code_review'], tmpDir);
  expect(result).toContain('Code Review Skill');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/skill-loader.test.ts --reporter=verbose`
Expected: FAIL — `code_review` doesn't resolve because only `code_review.md` is tried, not `code-review.md`

- [ ] **Step 3: Add hyphen fallback in resolveSkill**

In `packages/orchestrator/src/skill-loader.ts`, update `resolveSkill` to try the hyphenated variant after the exact filename. Replace the function body:

```typescript
function resolveSkill(agentId: string, skill: string, projectRoot: string): string | null {
  const sanitized = skill.replace(/[^a-z0-9_-]/gi, '');
  if (!sanitized) return null;
  const filename = `${sanitized}.md`;
  const hyphenFilename = `${sanitized.replace(/_/g, '-')}.md`;

  const bases = [
    resolve(projectRoot, '.gossip', 'agents', agentId, 'skills'),
    resolve(projectRoot, '.gossip', 'skills'),
    resolve(__dirname, 'default-skills'),
  ];

  for (const base of bases) {
    for (const fname of [filename, hyphenFilename]) {
      const candidate = resolve(base, fname);
      if (!candidate.startsWith(base + '/')) continue;
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/skill-loader.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/skill-loader.ts tests/orchestrator/skill-loader.test.ts
git commit -m "feat(skill-loader): resolve underscore skill names to hyphenated filenames"
```

---

### Task 3: Create DispatchPipeline class

**Files:**
- Create: `packages/orchestrator/src/dispatch-pipeline.ts`
- Test: `tests/orchestrator/dispatch-pipeline.test.ts`

This is the core of the refactor. DispatchPipeline encapsulates: task tracking, dispatch with memory/skills/TaskGraph, collect with post-task pipeline, dispatchParallel with gossip.

- [ ] **Step 1: Write failing tests for dispatch()**

Create `tests/orchestrator/dispatch-pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DispatchPipeline } from '@gossip/orchestrator';

// Minimal mock worker
function mockWorker(result = 'done') {
  return {
    executeTask: vi.fn().mockResolvedValue(result),
    subscribeToBatch: vi.fn().mockResolvedValue(undefined),
    unsubscribeFromBatch: vi.fn().mockResolvedValue(undefined),
  };
}

// Minimal mock registry entry
function mockRegistryGet(skills: string[] = ['testing']) {
  return { id: 'test-agent', provider: 'local' as const, model: 'mock', skills };
}

describe('DispatchPipeline', () => {
  let pipeline: DispatchPipeline;
  let workers: Map<string, any>;

  beforeEach(() => {
    workers = new Map([['test-agent', mockWorker()]]);
    pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-test-' + Date.now(),
      workers,
      registryGet: (id) => id === 'test-agent' ? mockRegistryGet() : undefined,
    });
  });

  describe('dispatch()', () => {
    it('dispatches to worker and returns taskId + promise', async () => {
      const { taskId, promise } = pipeline.dispatch('test-agent', 'review code');
      expect(taskId).toMatch(/^[a-f0-9]{8}$/);
      const result = await promise;
      expect(result).toBe('done');
      expect(workers.get('test-agent').executeTask).toHaveBeenCalledOnce();
    });

    it('throws for unknown agent', () => {
      expect(() => pipeline.dispatch('nope', 'task')).toThrow('Agent "nope" not found');
    });

    it('tracks task status after completion', async () => {
      const { taskId, promise } = pipeline.dispatch('test-agent', 'review code');
      await promise;
      const task = pipeline.getTask(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.result).toBe('done');
    });

    it('tracks task status after failure', async () => {
      workers.set('fail-agent', {
        executeTask: vi.fn().mockRejectedValue(new Error('boom')),
      });
      pipeline = new DispatchPipeline({
        projectRoot: '/tmp/gossip-test-' + Date.now(),
        workers,
        registryGet: (id) => id === 'fail-agent' ? { id: 'fail-agent', provider: 'local' as const, model: 'mock', skills: [] } : undefined,
      });

      const { taskId, promise } = pipeline.dispatch('fail-agent', 'bad task');
      await promise.catch(() => {});
      const task = pipeline.getTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.error).toBe('boom');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/dispatch-pipeline.test.ts --reporter=verbose`
Expected: FAIL — DispatchPipeline doesn't exist

- [ ] **Step 3: Create DispatchPipeline with dispatch() and getTask()**

Create `packages/orchestrator/src/dispatch-pipeline.ts`:

```typescript
import { randomUUID } from 'crypto';
import { AgentConfig, TaskEntry } from './types';
import { loadSkills } from './skill-loader';
import { assemblePrompt } from './prompt-assembler';
import { AgentMemoryReader } from './agent-memory';
import { MemoryWriter } from './memory-writer';
import { MemoryCompactor } from './memory-compactor';
import { TaskGraph } from './task-graph';
import { SkillCatalog } from './skill-catalog';
import { SkillGapTracker } from './skill-gap-tracker';
import { GossipPublisher } from './gossip-publisher';

interface WorkerLike {
  executeTask(task: string, lens?: string, promptContent?: string): Promise<string>;
  subscribeToBatch?(batchId: string): Promise<void>;
  unsubscribeFromBatch?(batchId: string): Promise<void>;
}

export interface DispatchPipelineConfig {
  projectRoot: string;
  workers: Map<string, WorkerLike>;
  registryGet: (agentId: string) => AgentConfig | undefined;
  gossipPublisher?: GossipPublisher | null;
}

type TrackedTask = TaskEntry & { promise: Promise<string> };

export class DispatchPipeline {
  private readonly projectRoot: string;
  private readonly workers: Map<string, WorkerLike>;
  private readonly registryGet: (agentId: string) => AgentConfig | undefined;

  private readonly taskGraph: TaskGraph;
  private readonly memWriter: MemoryWriter;
  private readonly memReader: AgentMemoryReader;
  private readonly memCompactor: MemoryCompactor;
  private readonly gapTracker: SkillGapTracker;
  private readonly catalog: SkillCatalog;
  private gossipPublisher: GossipPublisher | null;

  private tasks: Map<string, TrackedTask> = new Map();
  private batches: Map<string, Set<string>> = new Map();

  constructor(config: DispatchPipelineConfig) {
    this.projectRoot = config.projectRoot;
    this.workers = config.workers;
    this.registryGet = config.registryGet;
    this.gossipPublisher = config.gossipPublisher ?? null;

    this.taskGraph = new TaskGraph(config.projectRoot);
    this.memWriter = new MemoryWriter(config.projectRoot);
    this.memReader = new AgentMemoryReader(config.projectRoot);
    this.memCompactor = new MemoryCompactor(config.projectRoot);
    this.gapTracker = new SkillGapTracker(config.projectRoot);

    try { this.catalog = new SkillCatalog(); }
    catch { this.catalog = null as any; }
  }

  dispatch(agentId: string, task: string): { taskId: string; promise: Promise<string> } {
    const worker = this.workers.get(agentId);
    if (!worker) throw new Error(`Agent "${agentId}" not found`);

    const taskId = randomUUID().slice(0, 8);
    const agentSkills = this.registryGet(agentId)?.skills || [];

    // 1. Load skills
    const skills = loadSkills(agentId, agentSkills, this.projectRoot);

    // 2. Load memory
    const memory = this.memReader.loadMemory(agentId, task);

    // 3. Check skill coverage
    const skillWarnings = this.catalog
      ? this.catalog.checkCoverage(agentSkills, task)
      : [];

    // 4. Assemble prompt
    const promptContent = assemblePrompt({
      memory: memory || undefined,
      skills,
    });

    // 5. Record TaskGraph created
    this.taskGraph.recordCreated(taskId, agentId, task, agentSkills);

    // 6. Create task entry
    const entry: TrackedTask = {
      id: taskId, agentId, task, status: 'running',
      startedAt: Date.now(), skillWarnings,
      promise: null as any,
    };

    // 7. Execute
    entry.promise = worker.executeTask(task, undefined, promptContent)
      .then((result: string) => {
        entry.status = 'completed';
        entry.result = result;
        entry.completedAt = Date.now();
        return result;
      })
      .catch((err: Error) => {
        entry.status = 'failed';
        entry.error = err.message;
        entry.completedAt = Date.now();
        throw err;
      });

    this.tasks.set(taskId, entry);
    return { taskId, promise: entry.promise };
  }

  getTask(taskId: string): TaskEntry | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    return {
      id: t.id, agentId: t.agentId, task: t.task,
      status: t.status, result: t.result, error: t.error,
      startedAt: t.startedAt, completedAt: t.completedAt,
      skillWarnings: t.skillWarnings,
    };
  }

  async collect(taskIds?: string[], timeoutMs: number = 120_000): Promise<TaskEntry[]> {
    const targets = taskIds
      ? taskIds.map(id => this.tasks.get(id)).filter((t): t is TrackedTask => t !== undefined)
      : Array.from(this.tasks.values()).filter(t => t.status === 'running');

    if (targets.length === 0) return [];

    // Wait with timeout
    await Promise.race([
      Promise.all(targets.map(t => t.promise.catch(() => {}))),
      new Promise(r => setTimeout(r, timeoutMs)),
    ]);

    // Post-collect pipeline
    for (const t of targets) {
      const duration = t.completedAt ? t.completedAt - t.startedAt : -1;

      // 1. TaskGraph
      if (t.status === 'completed') {
        this.taskGraph.recordCompleted(t.id, (t.result || '').slice(0, 4000), duration);
      } else if (t.status === 'failed') {
        this.taskGraph.recordFailed(t.id, t.error || 'Unknown', duration);
      } else if (t.status === 'running') {
        this.taskGraph.recordCancelled(t.id, 'collect timeout', duration);
      }

      // 2. Write agent memory
      if (t.status === 'completed') {
        await this.memWriter.writeTaskEntry(t.agentId, {
          taskId: t.id, task: t.task,
          skills: this.registryGet(t.agentId)?.skills || [],
          scores: { relevance: 3, accuracy: 3, uniqueness: 3 },
        });
        this.memWriter.rebuildIndex(t.agentId);
      }

      // 3. Compact memory
      const compactResult = this.memCompactor.compactIfNeeded(t.agentId);
      if (compactResult.message) {
        process.stderr.write(`[gossipcat] ${compactResult.message}\n`);
      }
    }

    // 4. Skill gap check
    try {
      for (const t of targets) {
        if (t.status !== 'running') {
          this.gapTracker.getSuggestionsSince(t.agentId, t.startedAt);
        }
      }
      this.gapTracker.checkAndGenerate();
    } catch { /* non-blocking */ }

    // 5. Batch cleanup
    for (const [bid, taskIdSet] of this.batches) {
      const allDone = Array.from(taskIdSet).every(tid => {
        const bt = this.tasks.get(tid);
        return !bt || bt.status !== 'running';
      });
      if (allDone) {
        for (const tid of taskIdSet) {
          const bt = this.tasks.get(tid);
          if (bt) {
            const w = this.workers.get(bt.agentId);
            if (w?.unsubscribeFromBatch) w.unsubscribeFromBatch(bid).catch(() => {});
          }
        }
        this.batches.delete(bid);
      }
    }

    // Build clean result entries
    const results: TaskEntry[] = targets.map(t => ({
      id: t.id, agentId: t.agentId, task: t.task,
      status: t.status, result: t.result, error: t.error,
      startedAt: t.startedAt, completedAt: t.completedAt,
      skillWarnings: t.skillWarnings,
    }));

    // Cleanup completed tasks
    for (const t of targets) {
      if (t.status !== 'running') this.tasks.delete(t.id);
    }

    return results;
  }

  dispatchParallel(taskDefs: Array<{ agentId: string; task: string }>): {
    taskIds: string[];
    errors: string[];
  } {
    const taskIds: string[] = [];
    const errors: string[] = [];
    const batchId = randomUUID().slice(0, 8);
    const batchTaskIds = new Set<string>();

    // Subscribe workers to batch channel
    for (const def of taskDefs) {
      const worker = this.workers.get(def.agentId);
      if (worker?.subscribeToBatch) {
        worker.subscribeToBatch(batchId).catch(() => {});
      }
    }

    for (const def of taskDefs) {
      try {
        const { taskId, promise } = this.dispatch(def.agentId, def.task);
        taskIds.push(taskId);
        batchTaskIds.add(taskId);

        // Gossip trigger on completion
        if (this.gossipPublisher) {
          promise.then(async (result) => {
            const remaining = Array.from(batchTaskIds)
              .map(tid => this.tasks.get(tid))
              .filter((t): t is TrackedTask => t !== undefined && t.status === 'running' && t.agentId !== def.agentId)
              .map(t => this.registryGet(t.agentId))
              .filter((ac): ac is AgentConfig => ac !== undefined);

            if (remaining.length > 0) {
              this.gossipPublisher!.publishGossip({
                batchId,
                completedAgentId: def.agentId,
                completedResult: result,
                remainingSiblings: remaining.map(ac => ({
                  agentId: ac.id, preset: ac.preset || 'custom', skills: ac.skills,
                })),
              }).catch(err => process.stderr.write(`[gossipcat] Gossip: ${err.message}\n`));
            }
          }).catch(() => {});
        }
      } catch {
        errors.push(`Agent "${def.agentId}" not found`);
      }
    }

    this.batches.set(batchId, batchTaskIds);
    return { taskIds, errors };
  }

  /** Write memory inline (for handleMessage synchronous path) */
  async writeMemoryForTask(taskId: string): Promise<void> {
    const t = this.tasks.get(taskId);
    if (!t || t.status !== 'completed') return;

    const duration = t.completedAt ? t.completedAt - t.startedAt : -1;

    // Note: handleMessage path tasks are cleaned by writeMemoryForTask()
    // before they can appear as 'running' to collect(). No double-record risk.
    this.taskGraph.recordCompleted(t.id, (t.result || '').slice(0, 4000), duration);

    await this.memWriter.writeTaskEntry(t.agentId, {
      taskId: t.id, task: t.task,
      skills: this.registryGet(t.agentId)?.skills || [],
      scores: { relevance: 3, accuracy: 3, uniqueness: 3 },
    });
    this.memWriter.rebuildIndex(t.agentId);
    this.memCompactor.compactIfNeeded(t.agentId);
    this.tasks.delete(t.id);
  }

  setGossipPublisher(publisher: GossipPublisher | null): void {
    this.gossipPublisher = publisher;
  }

  /** Flush TaskGraph index on shutdown */
  flushTaskGraph(): void {
    this.taskGraph.flushIndex();
  }

  /** Get suggestion results for formatting in collect responses */
  getSkillSuggestions(agentId: string, sinceMs: number) {
    return this.gapTracker.getSuggestionsSince(agentId, sinceMs);
  }

  getSkeletonMessages(): string[] {
    return this.gapTracker.checkAndGenerate();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/dispatch-pipeline.test.ts --reporter=verbose`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts tests/orchestrator/dispatch-pipeline.test.ts
git commit -m "feat(orchestrator): add DispatchPipeline class with dispatch/collect/parallel"
```

---

### Task 4: Write collect() and dispatchParallel() tests

**Files:**
- Modify: `tests/orchestrator/dispatch-pipeline.test.ts`

- [ ] **Step 1: Add collect() tests**

Append to the describe block in `tests/orchestrator/dispatch-pipeline.test.ts`:

```typescript
  describe('collect()', () => {
    it('waits for tasks and returns results', async () => {
      const { taskId } = pipeline.dispatch('test-agent', 'review code');
      const results = await pipeline.collect([taskId]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('completed');
      expect(results[0].result).toBe('done');
    });

    it('collects all running tasks when no ids given', async () => {
      pipeline.dispatch('test-agent', 'task 1');
      pipeline.dispatch('test-agent', 'task 2');
      const results = await pipeline.collect();
      expect(results).toHaveLength(2);
    });

    it('returns empty array when no tasks match', async () => {
      const results = await pipeline.collect(['nonexistent']);
      expect(results).toHaveLength(0);
    });

    it('cleans up completed tasks after collect', async () => {
      const { taskId } = pipeline.dispatch('test-agent', 'review code');
      await pipeline.collect([taskId]);
      expect(pipeline.getTask(taskId)).toBeUndefined();
    });
  });

  describe('dispatchParallel()', () => {
    it('dispatches multiple tasks and returns ids', () => {
      workers.set('agent-b', mockWorker('result-b'));
      pipeline = new DispatchPipeline({
        projectRoot: '/tmp/gossip-test-' + Date.now(),
        workers,
        registryGet: (id) => ({ id, provider: 'local' as const, model: 'mock', skills: [] }),
      });

      const { taskIds, errors } = pipeline.dispatchParallel([
        { agentId: 'test-agent', task: 'task 1' },
        { agentId: 'agent-b', task: 'task 2' },
      ]);
      expect(taskIds).toHaveLength(2);
      expect(errors).toHaveLength(0);
    });

    it('reports errors for missing agents', () => {
      const { taskIds, errors } = pipeline.dispatchParallel([
        { agentId: 'test-agent', task: 'task 1' },
        { agentId: 'missing', task: 'task 2' },
      ]);
      expect(taskIds).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('missing');
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/dispatch-pipeline.test.ts --reporter=verbose`
Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/dispatch-pipeline.test.ts
git commit -m "test(dispatch-pipeline): add collect and dispatchParallel tests"
```

---

### Task 5: Export DispatchPipeline and TaskEntry from orchestrator

**Files:**
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Add exports**

In `packages/orchestrator/src/index.ts`, add after the MainAgent exports:

```typescript
export { DispatchPipeline } from './dispatch-pipeline';
export type { DispatchPipelineConfig } from './dispatch-pipeline';
```

`TaskEntry` is already exported via `export * from './types'`.

- [ ] **Step 2: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/index.ts
git commit -m "feat(orchestrator): export DispatchPipeline and DispatchPipelineConfig"
```

---

### Task 6: Integrate DispatchPipeline into MainAgent

**Files:**
- Modify: `packages/orchestrator/src/main-agent.ts`
- Modify: `tests/orchestrator/main-agent.test.ts`

- [ ] **Step 1: Write failing test for dispatch delegation**

In `tests/orchestrator/main-agent.test.ts`, add a new describe block:

```typescript
import { MainAgent, WorkerAgent, ILLMProvider } from '@gossip/orchestrator';
import { LLMMessage } from '@gossip/types';

describe('MainAgent dispatch pipeline', () => {
  it('exposes dispatch() that delegates to pipeline', () => {
    expect(typeof MainAgent.prototype.dispatch).toBe('function');
  });

  it('exposes collect() that delegates to pipeline', () => {
    expect(typeof MainAgent.prototype.collect).toBe('function');
  });

  it('exposes getWorker() to access workers', () => {
    expect(typeof MainAgent.prototype.getWorker).toBe('function');
  });
});

describe('MainAgent handleMessage → pipeline integration', () => {
  it('executeSubTask uses dispatch pipeline for task execution', async () => {
    // Mock LLM that produces a single assigned sub-task
    const mockLLM: ILLMProvider = {
      async generate(messages: LLMMessage[]) {
        if (messages[0]?.content?.toString().includes('task decomposition engine')) {
          return {
            text: JSON.stringify({
              strategy: 'single',
              subTasks: [{ description: 'review the code', requiredSkills: ['code_review'] }],
            }),
          };
        }
        return { text: 'synthesized result' };
      },
    };

    // Create MainAgent with a mock worker
    const mainAgent = new MainAgent({
      provider: 'local', model: 'mock', relayUrl: 'ws://localhost:0',
      agents: [{ id: 'reviewer', provider: 'local', model: 'mock', skills: ['code_review'] }],
      projectRoot: '/tmp/gossip-pipeline-test-' + Date.now(),
    });

    // Inject a mock worker that records calls
    const executeTaskCalls: string[] = [];
    const mockWorker = {
      executeTask: async (task: string, _lens?: string, promptContent?: string) => {
        executeTaskCalls.push(task);
        // Verify pipeline injected prompt content (memory/skills)
        // promptContent will be empty string for test env, but should be called with 3 args
        return 'review complete';
      },
      start: async () => {},
      stop: async () => {},
    };
    mainAgent.setWorkers(new Map([['reviewer', mockWorker as any]]));

    const response = await mainAgent.handleMessage('review the code');
    expect(response.status).toBe('done');
    expect(executeTaskCalls).toContain('review the code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/main-agent.test.ts --reporter=verbose`
Expected: FAIL — MainAgent has no dispatch/collect/getWorker methods

- [ ] **Step 3: Update MainAgent**

In `packages/orchestrator/src/main-agent.ts`:

1. Add `projectRoot` to `MainAgentConfig`:
```typescript
export interface MainAgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  relayUrl: string;
  agents: AgentConfig[];
  apiKeys?: Record<string, string>;
  projectRoot?: string;  // defaults to process.cwd()
}
```

2. Add import and instance field:
```typescript
import { DispatchPipeline } from './dispatch-pipeline';
```

3. In constructor, after existing setup, add:
```typescript
  private projectRoot: string;
  private pipeline: DispatchPipeline;
```

4. In constructor body, after registry setup:
```typescript
    this.projectRoot = config.projectRoot || process.cwd();
    this.pipeline = new DispatchPipeline({
      projectRoot: this.projectRoot,
      workers: this.workers,
      registryGet: (id) => this.registry.get(id),
    });
```

5. Add new public methods:
```typescript
  dispatch(agentId: string, task: string) { return this.pipeline.dispatch(agentId, task); }
  async collect(taskIds?: string[], timeoutMs?: number) { return this.pipeline.collect(taskIds, timeoutMs); }
  dispatchParallel(tasks: Array<{ agentId: string; task: string }>) { return this.pipeline.dispatchParallel(tasks); }
  getWorker(agentId: string) { return this.workers.get(agentId); }
  getTask(taskId: string) { return this.pipeline.getTask(taskId); }
  setGossipPublisher(publisher: any) { this.pipeline.setGossipPublisher(publisher); }
```

6. Add `syncWorkers` that accepts a key provider callback:
```typescript
  /** Register new agent configs (for hot-reload from config changes) */
  registerAgent(config: AgentConfig): void {
    this.registry.register(config);
  }

  async syncWorkers(keyProvider: (provider: string) => Promise<string | null>): Promise<number> {
    const { existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');

    let added = 0;
    for (const ac of this.registry.getAll()) {
      if (this.workers.has(ac.id)) continue;
      const key = await keyProvider(ac.provider);
      const llm = createProvider(ac.provider, ac.model, key ?? undefined);

      const instructionsPath = join(this.projectRoot, '.gossip', 'agents', ac.id, 'instructions.md');
      const instructions = existsSync(instructionsPath)
        ? readFileSync(instructionsPath, 'utf-8') : undefined;

      const worker = new WorkerAgent(ac.id, llm, this.relayUrl, ALL_TOOLS, instructions);
      await worker.start();
      this.workers.set(ac.id, worker);
      added++;
    }
    return added;
  }
```

7. Update `executeSubTask` to use pipeline:
```typescript
  private async executeSubTask(subTask: { assignedAgent?: string; description: string }): Promise<TaskResult> {
    const { taskId, promise } = this.pipeline.dispatch(subTask.assignedAgent!, subTask.description);
    const start = Date.now();
    try {
      const result = await promise;
      await this.pipeline.writeMemoryForTask(taskId);
      return { agentId: subTask.assignedAgent!, task: subTask.description, result, duration: Date.now() - start };
    } catch (err) {
      return {
        agentId: subTask.assignedAgent!, task: subTask.description,
        result: '', error: (err as Error).message, duration: Date.now() - start,
      };
    }
  }
```

8. Update `stop()` to flush TaskGraph:
```typescript
  async stop(): Promise<void> {
    this.pipeline.flushTaskGraph();
    for (const worker of this.workers.values()) {
      await worker.stop();
    }
    this.workers.clear();
  }
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/main-agent.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Run full orchestrator test suite**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run tests/orchestrator/ --reporter=verbose`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts tests/orchestrator/main-agent.test.ts
git commit -m "feat(main-agent): integrate DispatchPipeline, add dispatch/collect/syncWorkers"
```

---

### Task 7: Update chat.ts to pass projectRoot

**Files:**
- Modify: `apps/cli/src/chat.ts:122-128`

- [ ] **Step 1: Add projectRoot to MainAgentConfig**

In `apps/cli/src/chat.ts`, update the config construction (line ~122):

```typescript
  const mainAgentConfig: MainAgentConfig = {
    provider: config.main_agent.provider,
    model: config.main_agent.model,
    apiKey: mainKey || undefined,
    relayUrl: relay.url,
    agents: configToAgentConfigs(config),
    projectRoot: process.cwd(),
  };
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npx tsc --noEmit -p apps/cli/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/chat.ts
git commit -m "feat(chat): pass projectRoot to MainAgent for pipeline parity"
```

---

### Task 8: Slim down MCP server

**Files:**
- Rewrite: `apps/cli/src/mcp-server-sdk.ts`

This is the biggest change. Replace ~400 lines of inline pipeline logic with thin delegation to MainAgent.

- [ ] **Step 1: Rewrite mcp-server-sdk.ts**

Replace the entire file. Key changes:
- Remove module-level `tasks`, `batches`, `gossipPublisher`, `agentConfigsCache`
- Remove `syncWorkers()` — use `mainAgent.syncWorkers()`
- `gossip_dispatch` → `mainAgent.dispatch()`
- `gossip_dispatch_parallel` → `mainAgent.dispatchParallel()`
- `gossip_collect` → `mainAgent.collect()` + format results
- Keep `gossip_update_instructions`, `gossip_agents`, `gossip_status`, `gossip_tools` mostly as-is
- Boot still creates relay, tool server, workers, and sets them on MainAgent
- Boot creates gossipPublisher and passes it via `mainAgent.setGossipPublisher()`

The rewritten file:

```typescript
#!/usr/bin/env node
/**
 * Gossipcat MCP Server — thin adapter over MainAgent's dispatch pipeline.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

let booted = false;
let bootPromise: Promise<void> | null = null;
let relay: any = null;
let toolServer: any = null;
let workers: Map<string, any> = new Map();
let mainAgent: any = null;
let keychain: any = null;

let _modules: any = null;
async function getModules() {
  if (_modules) return _modules;
  _modules = {
    RelayServer: (await import('@gossip/relay')).RelayServer,
    ToolServer: (await import('@gossip/tools')).ToolServer,
    ALL_TOOLS: (await import('@gossip/tools')).ALL_TOOLS,
    MainAgent: (await import('@gossip/orchestrator')).MainAgent,
    WorkerAgent: (await import('@gossip/orchestrator')).WorkerAgent,
    createProvider: (await import('@gossip/orchestrator')).createProvider,
    GossipPublisher: (await import('@gossip/orchestrator')).GossipPublisher,
    ...(await import('./config')),
    Keychain: (await import('./keychain')).Keychain,
  };
  return _modules;
}

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = doBoot();
  return bootPromise;
}

async function doBoot() {
  const m = await getModules();

  const configPath = m.findConfigPath();
  if (!configPath) throw new Error('No gossip.agents.json found. Run gossipcat setup first.');

  const config = m.loadConfig(configPath);
  const agentConfigs = m.configToAgentConfigs(config);
  keychain = new m.Keychain();

  relay = new m.RelayServer({ port: 0 });
  await relay.start();

  toolServer = new m.ToolServer({ relayUrl: relay.url, projectRoot: process.cwd() });
  await toolServer.start();

  for (const ac of agentConfigs) {
    const key = await keychain.getKey(ac.provider);
    const llm = m.createProvider(ac.provider, ac.model, key ?? undefined);
    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');
    const instructionsPath = join(process.cwd(), '.gossip', 'agents', ac.id, 'instructions.md');
    const instructions = existsSync(instructionsPath)
      ? readFileSync(instructionsPath, 'utf-8') : undefined;

    const worker = new m.WorkerAgent(ac.id, llm, relay.url, m.ALL_TOOLS, instructions);
    await worker.start();
    workers.set(ac.id, worker);
  }

  const mainKey = await keychain.getKey(config.main_agent.provider);
  mainAgent = new m.MainAgent({
    provider: config.main_agent.provider,
    model: config.main_agent.model,
    apiKey: mainKey ?? undefined,
    relayUrl: relay.url,
    agents: agentConfigs,
    projectRoot: process.cwd(),
  });
  mainAgent.setWorkers(workers);
  await mainAgent.start();

  // Gossip publisher
  try {
    const { GossipAgent: GossipAgentPub } = await import('@gossip/client');
    const publisherAgent = new GossipAgentPub({
      agentId: 'gossip-publisher', relayUrl: relay.url, reconnect: true,
    });
    await publisherAgent.connect();

    const gossipPublisher = new m.GossipPublisher(
      m.createProvider(config.main_agent.provider, config.main_agent.model, mainKey ?? undefined),
      { publishToChannel: (channel: string, data: unknown) => publisherAgent.sendChannel(channel, data as Record<string, unknown>) }
    );
    mainAgent.setGossipPublisher(gossipPublisher);
    process.stderr.write(`[gossipcat] Gossip publisher ready\n`);
  } catch (err) {
    process.stderr.write(`[gossipcat] Gossip publisher failed: ${(err as Error).message}\n`);
  }

  booted = true;
  process.stderr.write(`[gossipcat] Booted: relay :${relay.port}, ${workers.size} workers\n`);
}

async function syncWorkersViaKeychain() {
  if (!booted || !keychain) return;
  const m = await getModules();
  const configPath = m.findConfigPath();
  if (!configPath) return;
  const config = m.loadConfig(configPath);
  const agentConfigs = m.configToAgentConfigs(config);
  // Register any new agents via public method
  for (const ac of agentConfigs) {
    mainAgent.registerAgent(ac);
  }
  await mainAgent.syncWorkers((provider: string) => keychain.getKey(provider));
}

// ── MCP Server ───────────────────────────────────────────────────────────
const server = new McpServer({ name: 'gossipcat', version: '0.1.0' });

server.tool(
  'gossip_orchestrate',
  'Submit a task to the Gossip Mesh orchestrator for multi-agent execution',
  { task: z.string().describe('The task to execute') },
  async ({ task }) => {
    await boot();
    try {
      const response = await mainAgent.handleMessage(task);
      const suffix = response.agents?.length ? `\n\n[Agents: ${response.agents.join(', ')}]` : '';
      return { content: [{ type: 'text' as const, text: response.text + suffix }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  'gossip_dispatch',
  'Send a task to a specific agent. Returns task ID for collecting results. Skills are auto-injected from the agent config — no need to pass them. The agent can read files itself via the Tool Server — pass file paths in the task, not file contents.',
  {
    agent_id: z.string().describe('Agent ID (e.g. "gemini-reviewer")'),
    task: z.string().describe('Task description. Reference file paths — the agent will read them via Tool Server.'),
  },
  async ({ agent_id, task }) => {
    await boot();
    await syncWorkersViaKeychain();
    if (!/^[a-zA-Z0-9_-]+$/.test(agent_id)) {
      return { content: [{ type: 'text' as const, text: `Invalid agent ID format: "${agent_id}"` }] };
    }
    try {
      const { taskId } = mainAgent.dispatch(agent_id, task);
      return { content: [{ type: 'text' as const, text: `Dispatched to ${agent_id}. Task ID: ${taskId}` }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `${err.message}. Available: ${Array.from(workers.keys()).join(', ')}` }] };
    }
  }
);

server.tool(
  'gossip_dispatch_parallel',
  'Fan out tasks to multiple agents simultaneously. Skills are auto-injected. Agents read files via Tool Server.',
  {
    tasks: z.array(z.object({
      agent_id: z.string(),
      task: z.string(),
    })).describe('Array of { agent_id, task }'),
  },
  async ({ tasks: taskDefs }) => {
    await boot();
    await syncWorkersViaKeychain();
    // Validate all agent IDs before dispatching
    for (const d of taskDefs) {
      if (!/^[a-zA-Z0-9_-]+$/.test(d.agent_id)) {
        return { content: [{ type: 'text' as const, text: `Invalid agent ID format: "${d.agent_id}"` }] };
      }
    }
    const { taskIds, errors } = mainAgent.dispatchParallel(
      taskDefs.map((d: any) => ({ agentId: d.agent_id, task: d.task }))
    );
    let msg = `Dispatched ${taskIds.length} tasks:\n${taskIds.map((tid: string) => {
      const t = mainAgent.getTask(tid);
      return `  ${tid} → ${t?.agentId || 'unknown'}`;
    }).join('\n')}`;
    if (errors.length) msg += `\nErrors: ${errors.join(', ')}`;
    return { content: [{ type: 'text' as const, text: msg }] };
  }
);

server.tool(
  'gossip_collect',
  'Collect results from dispatched tasks. Waits for completion by default.',
  {
    task_ids: z.array(z.string()).optional().describe('Task IDs to collect. Omit for all.'),
    timeout_ms: z.number().optional().describe('Max wait time. Default 120000.'),
  },
  async ({ task_ids, timeout_ms }) => {
    const entries = await mainAgent.collect(task_ids, timeout_ms || 120_000);
    if (entries.length === 0) {
      return { content: [{ type: 'text' as const, text: task_ids ? 'No matching tasks.' : 'No pending tasks.' }] };
    }

    const results = entries.map((t: any) => {
      const dur = t.completedAt ? `${t.completedAt - t.startedAt}ms` : 'running';
      let text: string;
      if (t.status === 'completed') text = `[${t.id}] ${t.agentId} (${dur}):\n${t.result}`;
      else if (t.status === 'failed') text = `[${t.id}] ${t.agentId} (${dur}): ERROR: ${t.error}`;
      else text = `[${t.id}] ${t.agentId}: still running...`;

      if (t.skillWarnings?.length) {
        text += `\n\n⚠️ Skill coverage gaps:\n${t.skillWarnings.map((w: string) => `  - ${w}`).join('\n')}`;
      }
      return text;
    });

    return { content: [{ type: 'text' as const, text: results.join('\n\n---\n\n') }] };
  }
);

server.tool(
  'gossip_agents',
  'List configured agents with provider, model, role, and skills',
  {},
  async () => {
    const { findConfigPath, loadConfig, configToAgentConfigs } = await import('./config');
    const configPath = findConfigPath();
    if (!configPath) return { content: [{ type: 'text' as const, text: 'No gossip.agents.json found.' }] };
    const config = loadConfig(configPath);
    const agents = configToAgentConfigs(config);
    const list = agents.map(a => `- ${a.id}: ${a.provider}/${a.model} (${a.preset || 'custom'}) — skills: ${a.skills.join(', ')}`).join('\n');
    return { content: [{ type: 'text' as const, text: `Orchestrator: ${config.main_agent.model} (${config.main_agent.provider})\n\nAgents:\n${list}` }] };
  }
);

server.tool(
  'gossip_status',
  'Check Gossip Mesh system status',
  {},
  async () => {
    return { content: [{ type: 'text' as const, text: [
      'Gossip Mesh Status:',
      `  Relay: ${relay ? `running :${relay.port}` : 'not started'}`,
      `  Tool Server: ${toolServer ? 'running' : 'not started'}`,
      `  Workers: ${workers.size} (${Array.from(workers.keys()).join(', ') || 'none'})`,
    ].join('\n') }] };
  }
);

server.tool(
  'gossip_update_instructions',
  'Update one or more worker agents\' instructions. Accepts a single agent_id or an array of agent_ids for batch updates.',
  {
    agent_ids: z.union([z.string(), z.array(z.string())]).describe('Single agent ID or array of agent IDs to update'),
    instruction_update: z.string().describe('New instructions content (max 5000 chars)'),
    mode: z.enum(['append', 'replace']).describe('"append" to add to existing, "replace" to overwrite'),
  },
  async ({ agent_ids, instruction_update, mode }) => {
    await boot();

    if (instruction_update.length > 5000) {
      return { content: [{ type: 'text' as const, text: 'Instruction update exceeds 5000 char limit.' }] };
    }

    const blocked = ['rm -rf', 'curl ', 'wget ', 'eval(', 'exec('];
    if (blocked.some(b => instruction_update.toLowerCase().includes(b))) {
      return { content: [{ type: 'text' as const, text: 'Instruction update contains blocked content.' }] };
    }

    const ids = Array.isArray(agent_ids) ? agent_ids : [agent_ids];
    const results: string[] = [];
    const { writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');

    for (const agent_id of ids) {
      if (!/^[a-zA-Z0-9_-]+$/.test(agent_id)) { results.push(`${agent_id}: invalid ID format`); continue; }
      const worker = mainAgent.getWorker(agent_id);
      if (!worker) { results.push(`${agent_id}: not found`); continue; }

      if (mode === 'replace') {
        const agentDir = join(process.cwd(), '.gossip', 'agents', agent_id);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'instructions-backup.md'), worker.getInstructions());
      }

      if (mode === 'replace') worker.setInstructions(instruction_update);
      else worker.setInstructions(worker.getInstructions() + '\n\n' + instruction_update);

      const agentDir = join(process.cwd(), '.gossip', 'agents', agent_id);
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'instructions.md'), worker.getInstructions());
      results.push(`${agent_id}: updated (${mode})`);
    }

    return { content: [{ type: 'text' as const, text: results.join('\n') }] };
  }
);

server.tool(
  'gossip_tools',
  'List all available gossipcat MCP tools with descriptions. Call after /mcp reconnect to discover new tools.',
  {},
  async () => {
    const tools = [
      { name: 'gossip_dispatch', desc: 'Send task to a specific agent (skills auto-injected)' },
      { name: 'gossip_dispatch_parallel', desc: 'Fan out tasks to multiple agents simultaneously' },
      { name: 'gossip_collect', desc: 'Collect results from dispatched tasks' },
      { name: 'gossip_orchestrate', desc: 'Submit task for multi-agent execution via MainAgent' },
      { name: 'gossip_agents', desc: 'List configured agents with provider, model, role, skills' },
      { name: 'gossip_status', desc: 'Check relay, tool-server, workers status' },
      { name: 'gossip_update_instructions', desc: 'Update agent instructions (single or batch). Modes: append/replace' },
      { name: 'gossip_tools', desc: 'List available tools (this command)' },
    ];
    const list = tools.map(t => `- ${t.name}: ${t.desc}`).join('\n');
    return { content: [{ type: 'text' as const, text: `Gossipcat Tools (${tools.length}):\n\n${list}` }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => { process.stderr.write(`[gossipcat] Fatal: ${err.message}\n`); process.exit(1); });
```

- [ ] **Step 2: Delete skill-loader-bridge.ts and skill-catalog-check.ts**

```bash
rm apps/cli/src/skill-loader-bridge.ts apps/cli/src/skill-catalog-check.ts
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/goku/Desktop/gossip && npx tsc --noEmit -p apps/cli/tsconfig.json`
Expected: No errors (no remaining imports of deleted files)

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git rm apps/cli/src/skill-loader-bridge.ts apps/cli/src/skill-catalog-check.ts
git commit -m "refactor(mcp): slim MCP server to thin adapter over MainAgent pipeline"
```

---

### Task 9: Verify parity — full regression + line counts

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/goku/Desktop/gossip && npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 2: Verify line counts**

Run: `wc -l packages/orchestrator/src/main-agent.ts packages/orchestrator/src/dispatch-pipeline.ts apps/cli/src/mcp-server-sdk.ts`
Expected:
- `main-agent.ts` ≤ 300 lines
- `dispatch-pipeline.ts` ≤ 200 lines
- `mcp-server-sdk.ts` ≤ 250 lines

- [ ] **Step 3: Verify deleted files are gone**

Run: `ls apps/cli/src/skill-loader-bridge.ts apps/cli/src/skill-catalog-check.ts 2>&1`
Expected: "No such file or directory" for both

- [ ] **Step 4: Verify no remaining imports of deleted files**

Run: `grep -r "skill-loader-bridge\|skill-catalog-check" apps/ packages/ tests/ --include="*.ts"`
Expected: No matches

- [ ] **Step 5: Build the dist**

Run: `cd /Users/goku/Desktop/gossip && npm run build`
Expected: Clean build, no errors
