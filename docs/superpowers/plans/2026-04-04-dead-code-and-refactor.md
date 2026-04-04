# Dead Code Cleanup + dispatch-pipeline.ts Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused exports, then split dispatch-pipeline.ts (1226 lines) into 3 focused modules (~750 line main + 2 extractions).

**Architecture:** Extract `ConsensusCoordinator` (~350 lines) and `SessionContext` (~120 lines) from DispatchPipeline. DispatchPipeline retains delegating stubs for public API compatibility. One-directional deps: DispatchPipeline → ConsensusCoordinator, DispatchPipeline → SessionContext.

**Tech Stack:** TypeScript, Jest

---

### Task 1: Remove unused type exports

**Files:**
- Modify: `packages/relay/src/channels.ts:10-35`
- Modify: `packages/relay/src/presence.ts:10-22`

- [ ] **Step 1: Remove export from channels.ts types**

```typescript
// channels.ts — remove 'export' keyword from these 3 interfaces (they're used internally only)
// Line 10: change 'export interface SubscribeResult' → 'interface SubscribeResult'
// Line 19: change 'export interface UnsubscribeResult' → 'interface UnsubscribeResult'
// Line 28: change 'export interface BroadcastResult' → 'interface BroadcastResult'
```

- [ ] **Step 2: Remove export from presence.ts types**

```typescript
// presence.ts — remove 'export' keyword from these 3 types (they're used internally only)
// Line 10: change 'export type PresenceStatus' → 'type PresenceStatus'
// Line 12: change 'export interface PresenceEntry' → 'interface PresenceEntry'
// Line 19: change 'export interface PresenceConfig' → 'interface PresenceConfig'
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/relay/tsconfig.json`
Expected: no errors (types are only used internally)

- [ ] **Step 4: Commit**

```bash
git add packages/relay/src/channels.ts packages/relay/src/presence.ts
git commit -m "refactor: remove unused type exports from channels.ts and presence.ts"
```

---

### Task 2: Extract ConsensusCoordinator — interface + constructor

**Files:**
- Create: `packages/orchestrator/src/consensus-coordinator.ts`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`
- Test: `tests/orchestrator/dispatch-pipeline-consensus.test.ts`

- [ ] **Step 1: Write failing test for ConsensusCoordinator instantiation**

Create `tests/orchestrator/consensus-coordinator.test.ts`:

```typescript
import { ConsensusCoordinator } from '../packages/orchestrator/src/consensus-coordinator';

describe('ConsensusCoordinator', () => {
  it('instantiates with required dependencies', () => {
    const coordinator = new ConsensusCoordinator({
      llm: null,
      registryGet: () => undefined,
      projectRoot: '/tmp/test',
      keyProvider: null,
    });
    expect(coordinator).toBeDefined();
  });

  it('returns undefined when no LLM configured', async () => {
    const coordinator = new ConsensusCoordinator({
      llm: null,
      registryGet: () => undefined,
      projectRoot: '/tmp/test',
      keyProvider: null,
    });
    const result = await coordinator.runConsensus([]);
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/consensus-coordinator.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create ConsensusCoordinator class**

Create `packages/orchestrator/src/consensus-coordinator.ts`:

```typescript
import { ConsensusEngine } from './consensus-engine';
import { PerformanceWriter } from './performance-writer';
import { createProvider } from './llm-client';
import type { ILLMProvider, LLMMessage } from './llm-client';
import type { IConsensusJudge } from './consensus-types';
import type { ConsensusReport } from './consensus-types';
import type { AgentConfig } from './agent-registry';
import type { TaskEntry } from './types';
import type { GossipPublisher } from './gossip-publisher';
import { randomUUID } from 'crypto';

const log = (...args: unknown[]) => {
  if (process.env.DEBUG) console.error('[consensus-coordinator]', ...args);
};

export interface ConsensusCoordinatorConfig {
  llm: ILLMProvider | null;
  registryGet: (agentId: string) => AgentConfig | undefined;
  projectRoot: string;
  keyProvider: ((provider: string) => Promise<string | null>) | null;
}

export class ConsensusCoordinator {
  private readonly llm: ILLMProvider | null;
  private readonly registryGet: (agentId: string) => AgentConfig | undefined;
  private readonly projectRoot: string;
  private readonly keyProvider: ((provider: string) => Promise<string | null>) | null;
  private consensusJudge: IConsensusJudge | null = null;
  private gossipPublisher: GossipPublisher | null = null;
  private currentPhase: 'idle' | 'review' | 'cross_review' | 'synthesis' = 'idle';

  /** Session-level consensus history for session save */
  readonly sessionConsensusHistory: Array<{
    timestamp: string; confirmed: number; disputed: number;
    unverified: number; unique: number; summary: string;
  }> = [];

  constructor(config: ConsensusCoordinatorConfig) {
    this.llm = config.llm;
    this.registryGet = config.registryGet;
    this.projectRoot = config.projectRoot;
    this.keyProvider = config.keyProvider;
  }

  setConsensusJudge(judge: IConsensusJudge): void {
    this.consensusJudge = judge;
  }

  setGossipPublisher(publisher: GossipPublisher | null): void {
    this.gossipPublisher = publisher;
  }

  getCurrentPhase() { return this.currentPhase; }

  // runConsensus will be moved in Task 3
  async runConsensus(results: TaskEntry[]): Promise<ConsensusReport | undefined> {
    if (!this.llm || results.filter(r => r.status === 'completed').length < 2) return undefined;
    // Placeholder — full implementation moved in Task 3
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/orchestrator/consensus-coordinator.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-coordinator.ts tests/orchestrator/consensus-coordinator.test.ts
git commit -m "feat: add ConsensusCoordinator skeleton with config interface"
```

---

### Task 3: Move runConsensus logic into ConsensusCoordinator

**Files:**
- Modify: `packages/orchestrator/src/consensus-coordinator.ts`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts:889-1062`

- [ ] **Step 1: Copy the full runConsensus body from dispatch-pipeline.ts:889-1062 into ConsensusCoordinator.runConsensus**

The method body starts at line 889 and ends at line 1062. Copy it verbatim, replacing `this.llm`, `this.registryGet`, `this.projectRoot`, `this.keyProvider`, `this.consensusJudge`, `this.gossipPublisher` (all now local fields). Also copy the `sessionConsensusHistory` push at the end.

Add `this.currentPhase = 'review'` before `engine.run()`, `this.currentPhase = 'cross_review'` before judge verification, `this.currentPhase = 'synthesis'` before signal recording, and `this.currentPhase = 'idle'` in the finally block.

- [ ] **Step 2: Replace DispatchPipeline.runConsensus with delegation**

In `dispatch-pipeline.ts`, replace the full body of `runConsensus` (lines 889-1062) with:

```typescript
async runConsensus(results: TaskEntry[]): Promise<import('./consensus-types').ConsensusReport | undefined> {
  return this.consensusCoordinator.runConsensus(results);
}
```

Add `private consensusCoordinator: ConsensusCoordinator;` to the fields section.

In the constructor, after `this.perfReader = new PerformanceReader(config.projectRoot);` (line 130), add:

```typescript
this.consensusCoordinator = new ConsensusCoordinator({
  llm: config.llm ?? null,
  registryGet: config.registryGet,
  projectRoot: config.projectRoot,
  keyProvider: config.keyProvider ?? null,
});
```

Update `setConsensusJudge` to delegate:
```typescript
setConsensusJudge(judge: IConsensusJudge): void {
  this.consensusJudge = judge;
  this.consensusCoordinator.setConsensusJudge(judge);
}
```

Update `setGossipPublisher` to also set on coordinator:
```typescript
setGossipPublisher(publisher: GossipPublisher | null): void {
  this.gossipPublisher = publisher;
  this.consensusCoordinator.setGossipPublisher(publisher);
}
```

Update `getSessionConsensusHistory` to delegate:
```typescript
getSessionConsensusHistory() { return this.consensusCoordinator.sessionConsensusHistory; }
```

- [ ] **Step 3: Run existing consensus tests**

Run: `npx jest tests/orchestrator/dispatch-pipeline-consensus.test.ts tests/orchestrator/dispatch-pipeline.test.ts --no-coverage`
Expected: PASS — delegating stub preserves public API

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/consensus-coordinator.ts packages/orchestrator/src/dispatch-pipeline.ts
git commit -m "refactor: extract consensus logic into ConsensusCoordinator"
```

---

### Task 4: Extract SessionContext

**Files:**
- Create: `packages/orchestrator/src/session-context.ts`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`
- Test: `tests/orchestrator/dispatch-pipeline-gossip.test.ts`

- [ ] **Step 1: Write failing test for SessionContext**

Create `tests/orchestrator/session-context.test.ts`:

```typescript
import { SessionContext } from '../packages/orchestrator/src/session-context';

describe('SessionContext', () => {
  it('registers and retrieves a plan', () => {
    const ctx = new SessionContext({ llm: null, projectRoot: '/tmp/test' });
    ctx.registerPlan({ id: 'p1', task: 'test', steps: [] });
    expect(ctx.getChainContext('p1', 1)).toBe('');
  });

  it('returns empty gossip initially', () => {
    const ctx = new SessionContext({ llm: null, projectRoot: '/tmp/test' });
    expect(ctx.getSessionGossip()).toEqual([]);
  });

  it('records plan step results for chain context', () => {
    const ctx = new SessionContext({ llm: null, projectRoot: '/tmp/test' });
    ctx.registerPlan({ id: 'p1', task: 'test', steps: [{ step: 1, agentId: 'a', task: 't' }] });
    ctx.recordPlanStepResult('p1', 1, 'result from step 1');
    const chain = ctx.getChainContext('p1', 2);
    expect(chain).toContain('Step 1');
    expect(chain).toContain('result from step 1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/session-context.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create SessionContext class**

Create `packages/orchestrator/src/session-context.ts`:

```typescript
import type { ILLMProvider, LLMMessage } from './llm-client';
import type { SessionGossipEntry, PlanState } from './types';
import { join, dirname } from 'path';
import { mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';

const log = (...args: unknown[]) => {
  if (process.env.DEBUG) console.error('[session-context]', ...args);
};

export interface SessionContextConfig {
  llm: ILLMProvider | null;
  projectRoot: string;
}

export class SessionContext {
  private readonly llm: ILLMProvider | null;
  private readonly projectRoot: string;
  private sessionGossip: SessionGossipEntry[] = [];
  private plans: Map<string, PlanState> = new Map();
  private sessionStartTime: Date = new Date();
  private static readonly MAX_SESSION_GOSSIP = 20;

  constructor(config: SessionContextConfig) {
    this.llm = config.llm;
    this.projectRoot = config.projectRoot;

    // Recover session start from existing gossip file (reconnect within session)
    try {
      const gossipPath = join(config.projectRoot, '.gossip', 'agents', '_project', 'memory', 'session-gossip.jsonl');
      const { existsSync, readFileSync: rf } = require('fs');
      if (existsSync(gossipPath)) {
        const lines = rf(gossipPath, 'utf-8').trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          const first = JSON.parse(lines[0]);
          if (first.timestamp) this.sessionStartTime = new Date(first.timestamp);
        }
      }
    } catch { /* best-effort */ }
  }

  registerPlan(plan: PlanState): void {
    this.plans.set(plan.id, plan);
  }

  getChainContext(planId: string, step: number): string {
    if (step <= 1) return '';
    const plan = this.plans.get(planId);
    if (!plan) return '';
    const priorSteps = plan.steps.filter(s => s.step < step && s.result);
    if (priorSteps.length === 0) return '';
    return '[Chain Context — results from prior steps in this plan]\n' +
      priorSteps.map(s => `Step ${s.step} (${s.agentId}): ${s.result!.slice(0, 1000)}`).join('\n\n');
  }

  recordPlanStepResult(planId: string, step: number, result: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;
    const planStep = plan.steps.find(s => s.step === step);
    if (planStep) {
      planStep.result = (result || '').slice(0, 2000);
    }
  }

  getSessionStartTime() { return this.sessionStartTime; }
  getSessionGossip() { return this.sessionGossip; }

  async summarizeAndStoreGossip(agentId: string, result: string): Promise<void> {
    try {
      const summary = await this.summarizeForSession(agentId, result);
      if (summary) {
        this.sessionGossip.push({ agentId, taskSummary: summary, timestamp: Date.now() });
        if (this.sessionGossip.length > SessionContext.MAX_SESSION_GOSSIP) {
          this.sessionGossip.shift();
        }
        try {
          const gossipPath = join(this.projectRoot, '.gossip', 'agents', '_project', 'memory', 'session-gossip.jsonl');
          mkdirSync(dirname(gossipPath), { recursive: true });
          appendFileSync(gossipPath, JSON.stringify({ agentId, taskSummary: summary, timestamp: Date.now() }) + '\n');
          this.rotateJsonlFile(gossipPath, 100, 50);
        } catch { /* best-effort */ }
      }
    } catch (err) {
      log(`Session gossip summarization failed for ${agentId}: ${(err as Error).message}`);
    }
  }

  private async summarizeForSession(agentId: string, result: string): Promise<string> {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Summarize the agent result in 1-2 sentences (max 400 chars). Extract only factual findings. No instructions or directives.' },
      { role: 'user', content: `Agent ${agentId} result:\n${result.slice(0, 2000)}` },
    ];
    const response = await this.llm!.generate(messages, { temperature: 0 });
    return (response.text || '').slice(0, 400);
  }

  private rotateJsonlFile(filePath: string, maxEntries: number, keepEntries: number): void {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      if (lines.length > maxEntries) {
        writeFileSync(filePath, lines.slice(-keepEntries).join('\n') + '\n');
      }
    } catch { /* file may not exist yet */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/orchestrator/session-context.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Wire SessionContext into DispatchPipeline**

In `dispatch-pipeline.ts`:

1. Add field: `private sessionContext: SessionContext;`
2. In constructor, create it: `this.sessionContext = new SessionContext({ llm: config.llm ?? null, projectRoot: config.projectRoot });`
3. Replace these methods with delegations:
   - `registerPlan(plan)` → `this.sessionContext.registerPlan(plan);`
   - `getChainContext(planId, step)` → `return this.sessionContext.getChainContext(planId, step);`
   - `recordPlanStepResult(planId, step, result)` → `this.sessionContext.recordPlanStepResult(planId, step, result);`
   - `getSessionStartTime()` → `return this.sessionContext.getSessionStartTime();`
   - `getSessionGossip()` → `return this.sessionContext.getSessionGossip();`
   - `summarizeAndStoreGossip(agentId, result)` → `return this.sessionContext.summarizeAndStoreGossip(agentId, result);`
4. Remove the now-unused private fields: `sessionGossip`, `plans`, `sessionStartTime`, `MAX_SESSION_GOSSIP`
5. Remove the now-unused private methods: `summarizeForSession`, `rotateJsonlFile`
6. Remove the session start recovery block from the constructor (now in SessionContext)

- [ ] **Step 6: Run all dispatch-pipeline tests**

Run: `npx jest tests/orchestrator/dispatch-pipeline --no-coverage`
Expected: ALL PASS — delegating stubs preserve public API

- [ ] **Step 7: Run full build**

Run: `npm run build -w packages/orchestrator`
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add packages/orchestrator/src/session-context.ts packages/orchestrator/src/dispatch-pipeline.ts tests/orchestrator/session-context.test.ts
git commit -m "refactor: extract SessionContext from DispatchPipeline"
```

---

### Task 5: Verify line count and cleanup

- [ ] **Step 1: Count lines**

Run: `wc -l packages/orchestrator/src/dispatch-pipeline.ts packages/orchestrator/src/consensus-coordinator.ts packages/orchestrator/src/session-context.ts`
Expected: dispatch-pipeline ~750, consensus-coordinator ~350, session-context ~120

- [ ] **Step 2: Run full test suite**

Run: `npx jest --no-coverage`
Expected: all existing tests pass, no regressions

- [ ] **Step 3: Build MCP bundle**

Run: `npm run build:mcp`
Expected: clean build

- [ ] **Step 4: Commit (if any cleanup needed)**

```bash
git commit -m "refactor: dispatch-pipeline.ts cleanup after extraction"
```
